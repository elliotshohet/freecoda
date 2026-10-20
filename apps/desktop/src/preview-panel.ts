import { WebContentsView, session, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { previewBounds, previewURL, type PreviewBounds } from "./preview-security";
import type { DesktopPreviewInput, DesktopPreviewState } from "./shared";

/** Untrusted preview pages never receive the app preload or any app credentials. */
export class DesktopPreview {
  private view?: WebContentsView;
  private visible = false;
  private suspended = false;
  private error?: string;
  private url = "";
  private bounds?: PreviewBounds;
  private generation = 0;
  constructor(private host: BrowserWindow, private emit: (state: DesktopPreviewState) => void) {
    host.on("resize", this.resize);
    host.once("closed", () => this.dispose());
  }
  state(): DesktopPreviewState {
    const contents = this.view?.webContents;
    const live = contents && !contents.isDestroyed() ? contents : undefined;
    return { visible: this.visible && !this.suspended, url: live?.getURL() || this.url, loading: live?.isLoading() || false,
      canGoBack: live?.navigationHistory.canGoBack() || false, canGoForward: live?.navigationHistory.canGoForward() || false,
      ...(this.error ? { error: this.error } : {}) };
  }
  setSuspended(value: boolean) {
    this.suspended = value;
    this.view?.setVisible(this.visible && !value);
    this.publish();
  }
  private publish = () => this.emit(this.state());
  private resize = () => {
    if (!this.view || !this.bounds || this.host.isDestroyed()) return;
    const [width, height] = this.host.getContentSize();
    this.view.setBounds(previewBounds(this.bounds, width, height));
  };
  private create(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
    const isolated = session.fromPartition(`freecoda-preview-${randomUUID()}`);
    isolated.setPermissionCheckHandler(() => false);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.on("will-download", event => { event.preventDefault(); this.error = "Preview downloads are disabled."; this.publish(); });
    const view = new WebContentsView({ webPreferences: { session: isolated, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false } });
    this.view = view;
    view.webContents.setWindowOpenHandler(() => { this.error = "Open links in this preview using its address bar."; this.publish(); return { action: "deny" }; });
    const navigation = (event: Electron.Event, url: string) => { try { previewURL(url); } catch { event.preventDefault(); this.error = "Preview supports only HTTP and HTTPS navigation."; this.publish(); } };
    view.webContents.on("will-navigate", navigation);
    view.webContents.on("will-redirect", navigation);
    view.webContents.on("will-frame-navigate", (event) => navigation(event, event.url));
    view.webContents.on("did-navigate", (_event, url) => { this.url = url; this.error = undefined; this.publish(); });
    view.webContents.on("did-navigate-in-page", (_event, url, main) => { if (main) { this.url = url; this.publish(); } });
    view.webContents.on("did-start-loading", this.publish);
    view.webContents.on("did-stop-loading", this.publish);
    view.webContents.on("did-fail-load", (_event, code, description, _url, main) => { if (main && code !== -3) { this.error = `Preview could not load: ${description}`; this.publish(); } });
    view.webContents.on("render-process-gone", () => { this.error = "Preview stopped. Open the URL again to reload it."; this.publish(); });
    view.webContents.once("destroyed", () => { void isolated.clearStorageData().catch(() => {}); });
    this.host.contentView.addChildView(view);
    return view;
  }
  async command(input: DesktopPreviewInput): Promise<DesktopPreviewState> {
    if (!input || !["open", "show", "hide", "back", "forward", "reload", "resize"].includes(input.action)) throw Error("Choose a valid preview action.");
    if (this.host.isDestroyed()) throw Error("The desktop window is closed.");
    if (input.action === "hide") { this.visible = false; this.view?.setVisible(false); this.publish(); return this.state(); }
    if (input.action === "open" || input.action === "show" || input.action === "resize") {
      const [width, height] = this.host.getContentSize();
      this.bounds = previewBounds(input.bounds, width, height);
    }
    if (input.action === "open") {
      const url = previewURL(input.url);
      const view = this.create();
      this.error = undefined; this.url = url; this.visible = true;
      view.setVisible(!this.suspended); this.resize(); this.publish();
      const generation = ++this.generation;
      try { await view.webContents.loadURL(url); }
      catch (error) { if (generation === this.generation && !view.webContents.isDestroyed()) { this.error = error instanceof Error ? error.message : "Preview could not load."; this.publish(); } }
    } else if (input.action === "show") {
      if (!this.view || this.view.webContents.isDestroyed()) throw Error("Open a preview address first.");
      this.visible = true; this.view.setVisible(!this.suspended); this.resize(); this.publish();
    } else {
      const contents = this.view?.webContents;
      if (contents && !contents.isDestroyed()) {
        if (input.action === "resize") this.resize();
        if (input.action === "back" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
        if (input.action === "forward" && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
        if (input.action === "reload") { this.error = undefined; contents.reload(); }
      }
    }
    return this.state();
  }
  dispose() {
    this.generation++;
    this.host.removeListener("resize", this.resize);
    if (this.view) {
      if (!this.host.isDestroyed()) this.host.contentView.removeChildView(this.view);
      if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
      this.view = undefined;
    }
    this.visible = false;
  }
}
