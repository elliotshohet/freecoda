import { WebContentsView, session, systemPreferences, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";

/** Only service-created, authenticated loopback pages may enter the voice surface. */
export function voicePanelURL(value: string): URL {
  if (!/^http:\/\/127\.0\.0\.1:[0-9]+\/#[a-f0-9]{64}$/.test(value)) throw Error("Invalid voice panel URL.");
  const url = new URL(value);
  if (Number(url.port) < 1 || Number(url.port) > 65535) throw Error("Invalid voice panel port.");
  return url;
}

export type VoicePanelHandle = (() => void) & { setSuspended(value: boolean): void };

/** A separate sandbox within the existing desktop window, never an external browser. */
export async function openVoicePanel(host: BrowserWindow, value: string, onStop: () => void): Promise<VoicePanelHandle> {
  const target = voicePanelURL(value);
  if (host.isDestroyed()) throw Error("Open the desktop window before starting voice.");
  const isolated = session.fromPartition(`freecoda-voice-${randomUUID()}`);
  const view = new WebContentsView({ webPreferences: {
    session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true,
    webSecurity: true, allowRunningInsecureContent: false, spellcheck: false,
  } });
  let closed = false;
  const ownOrigin = (url: string) => { try { return new URL(url).origin === target.origin; } catch { return false; } };
  isolated.setPermissionCheckHandler((contents, permission, origin, details) =>
    !closed && contents === view.webContents && permission === "media" && ownOrigin(origin) && details.mediaType === "audio");
  isolated.setPermissionRequestHandler((contents, permission, callback, details) => {
    const allowed = !closed && contents === view.webContents && permission === "media" &&
      ownOrigin(details.requestingUrl) && "mediaTypes" in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === "audio";
    if (!allowed) { callback(false); return; }
    if (process.platform === "darwin") {
      void systemPreferences.askForMediaAccess("microphone").then(granted => callback(granted && !closed)).catch(() => callback(false));
    } else callback(true);
  });
  isolated.on("will-download", event => event.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event, url) => { if (!ownOrigin(url)) event.preventDefault(); });
  view.webContents.on("will-redirect", (event, url) => { if (!ownOrigin(url)) event.preventDefault(); });
  const resize = () => {
    if (closed || host.isDestroyed()) return;
    const [width, height] = host.getContentSize();
    const panelWidth = Math.min(700, Math.max(1, width - 32));
    view.setBounds({ x: Math.round((width - panelWidth) / 2), y: 60, width: panelWidth, height: Math.max(1, height - 230) });
  };
  const close = () => {
    if (closed) return;
    closed = true;
    host.removeListener("resize", resize);
    host.removeListener("closed", stop);
    if (!host.isDestroyed()) host.contentView.removeChildView(view);
    isolated.setPermissionCheckHandler(() => false);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    if (!view.webContents.isDestroyed()) view.webContents.close();
    void isolated.clearStorageData().catch(() => {});
  };
  const stop = () => { close(); onStop(); };
  view.webContents.on("before-input-event", (event, input) => { if (input.type === "keyDown" && input.key === "Escape") { event.preventDefault(); stop(); } });
  view.webContents.on("render-process-gone", stop);
  host.on("resize", resize);
  host.once("closed", stop);
  host.contentView.addChildView(view);
  resize();
  try { await view.webContents.loadURL(target.toString()); }
  catch (error) { close(); throw error; }
  if (closed) throw Error("Voice opening was cancelled.");
  view.webContents.focus();
  return Object.assign(close, { setSuspended(value: boolean) { if (!closed) view.setVisible(!value); } });
}
