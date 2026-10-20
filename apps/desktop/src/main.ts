import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  dialog,
  ipcMain,
  net,
  nativeTheme,
  nativeImage,
  Notification,
  protocol,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";
import path from "node:path";
import { readFileSync, watchFile, unwatchFile } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { APP_URL, assetPath, externalURL, isAppDocument } from "./security";
import { LocalAgentService } from "./local-agent";
import { DesktopSessionManager } from "./desktop-session-manager";
import type { DesktopCreateSessionInput } from "./desktop-sessions";
import { DesktopTerminalManager, type TerminalLaunchRequest } from "./interactive-terminal";
import { discoverExternalAgents } from "./external-agents";
import type { DesktopEvent } from "./shared";
import { autoUpdater } from "electron-updater";
import { DesktopUpdates } from "./updater";
import { openVoicePanel, type VoicePanelHandle } from "./voice-panel";
import { DesktopPreview } from "./preview-panel";
import type { DesktopPreviewInput } from "./shared";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "freecoda",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
app.setName("Freecoda");
if (process.platform === "win32") app.setAppUserModelId("com.freecoda.desktop");
const assetsDirectory = path.join(app.getAppPath(), "dist");
let window: BrowserWindow | null = null;
let preview: DesktopPreview | undefined;
let voicePanel: VoicePanelHandle | undefined;
let nativeModalOpen = false;
let service: LocalAgentService;
let sessions: DesktopSessionManager;
let terminals: DesktopTerminalManager | undefined;
let terminalGeneration = 0;
const sessionContextEpochs = new Map<string, number>();
const contextChangingIPC = new Set(["openFolder", "openRecentFolder", "trustWorkspace", "setConversationMode", "createThread", "openThread", "setThreadArchived", "deleteThread", "clearHistory", "refreshConversations", "setPermissions"]);
let quitting = false;
let closing = false;
let updates: DesktopUpdates | undefined;
let tray: Tray | null = null;
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
function showWindow() {
  if (quitting) return;
  if (!window || window.isDestroyed()) {
    if (app.isReady() && service) createWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
app.on("second-instance", showWindow);
app.on("activate", showWindow);
function installTray() {
  if (tray && !tray.isDestroyed()) return;
  try {
    const icon = nativeImage.createFromPath(path.join(assetsDirectory, "icon.png"))
      .resize({ width: process.platform === "darwin" ? 18 : 24, height: process.platform === "darwin" ? 18 : 24 });
    if (icon.isEmpty()) throw Error("The Freecoda tray icon could not be loaded.");
    tray = new Tray(icon);
    tray.setToolTip("Freecoda");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show Freecoda", click: showWindow },
      { type: "separator" },
      { label: "Quit Freecoda", click: () => app.quit() },
    ]));
    tray.on("click", showWindow);
  } catch (error) {
    tray?.destroy();
    tray = null;
    console.warn("Freecoda tray unavailable:", error instanceof Error ? error.message : "Unknown error");
  }
}
async function confirmQuit() {
  if (closing || quitting) return;
  closing = true;
  try {
    const options: Electron.MessageBoxOptions = {
      type: "question",
      buttons: ["Keep working", "Quit Freecoda"],
      defaultId: 0,
      cancelId: 0,
      title: "Quit Freecoda?",
      message: "Quit Freecoda?",
      detail: "Save any unsaved editor changes first. Active agent work and commands will be cancelled. Closing the window instead keeps your workspace available from the Freecoda tray icon.",
    };
    const result = window && !window.isDestroyed() && window.isVisible()
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    if (result.response !== 1) return;
    if (window && !window.isDestroyed()) await window.webContents.executeJavaScript("globalThis.flushComposerDraft?.()", true);
    await stopTerminals();
    await service.dispose();
    updates?.dispose();
    quitting = true;
    app.quit();
  } catch (error) {
    dialog.showErrorBox("Could not quit Freecoda", error instanceof Error ? error.message : "Try again.");
  } finally {
    closing = false;
  }
}
const openExternal = async (value: string) => {
  await shell.openExternal(externalURL(value));
};
const emit = (event: DesktopEvent) => {
  if (window && !window.isDestroyed())
    try { window.webContents.send("desktop:event", event); } catch { /* Closing the renderer must not interrupt a service run. */ }
};
function validateSender(event: IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !isAppDocument(event.senderFrame.url)
  )
    throw new Error("Untrusted desktop request.");
}
async function chooseFolder() {
  if (!window) return null;
  const owner = sessions.snapshot().activeSessionId;
  if (terminals?.list(owner).length) throw Error("Close the interactive terminal before changing folders.");
  sessionContextEpochs.set(owner, (sessionContextEpochs.get(owner) || 0) + 1);
  if (!await window.webContents.executeJavaScript("globalThis.prepareSessionSwitch?.() ?? false")) throw Error("Save editor changes and finish pending commands or dialogs before choosing a folder.");
  const current = await service.getState();
  if (current.running)
    throw new Error("Stop the active task before changing folders.");
  if (current.workspace) {
    const { response } = await dialog.showMessageBox(window, {
      type: "question",
      buttons: ["Keep current folder", "Choose another folder"],
      defaultId: 0,
      cancelId: 0,
      message: "Switch project folders?",
      detail:
        "Save any unsaved editor changes before switching. Changes in the editor will be discarded.",
    });
    if (response !== 1) return null;
  }
  const result = await dialog.showOpenDialog(window, {
    title: "Open a project folder",
    properties: ["openDirectory"],
  });
  return result.canceled || !result.filePaths[0]
    ? null
    : service.selectWorkspace(result.filePaths[0]);
}
async function openRecentFolder(root: string) {
  if (!window) return null;
  const current = await service.getState();
  if (current.running)
    throw new Error("Stop the active task before changing folders.");
  if (typeof root !== "string" || ![...current.recentFolders, ...current.openFolders].some(folder => folder.root === root))
    throw new Error("Choose this folder with the native folder picker first.");
  return service.openRecentFolder(root);
}
async function stopTerminals() {
  terminalGeneration++;
  const previous = terminals; terminals = undefined;
  await previous?.dispose();
}
function terminalManager() {
  return terminals ??= new DesktopTerminalManager({
    emit: event => emit({ type: "terminal-event", event }),
    authorize: async request => {
      if (!window || window.isDestroyed() || nativeModalOpen) throw Error("Close the current dialog before connecting a terminal.");
      const owner = sessions.snapshot().activeSessionId;
      const generation = terminalGeneration;
      const contextEpoch = sessionContextEpochs.get(owner) || 0;
      const source = sessions.currentService();
      const before = await source.getState();
      const account = await source.sessionAccountScope();
      if (request.mode !== "build" || !before.auth.signedIn || before.conversationMode !== "coding" || !before.workspace?.trusted || before.workspace.root !== request.root || before.permissionPreset !== "full-access") throw Error("Select a trusted coding folder in Build mode with command permissions first.");
      const name = request.agentId === "codex" ? "Codex" : request.agentId === "claude" ? "Claude Code" : "an interactive shell";
      const result = await dialog.showMessageBox(window, {
        type: "warning", title: "Connect interactive terminal", buttons: ["Cancel", "Connect"], defaultId: 0, cancelId: 0,
        message: `Open ${name} in ${before.workspace.name}?`,
        detail: `Folder: ${before.workspace.root}\n\nThis interactive process runs as your user, can access files outside this folder, and is not an OS sandbox. Typed input is sent directly to the process; Freecoda tool approvals do not mediate its commands. ${request.agentId ? "The agent uses its own existing sign-in, configuration, approvals and billing, not Freecoda's free hosted allowance. No credentials are copied or installation performed." : "Only start commands you intend to run. Close the terminal before this workspace's managed agent can modify files."}`,
      });
      if (result.response !== 1) throw Error("Terminal connection cancelled.");
      const current = await source.getState();
      const isCurrent = () => generation === terminalGeneration && contextEpoch === (sessionContextEpochs.get(owner) || 0) && sessions.snapshot().activeSessionId === owner && !nativeModalOpen && !!window && !window.isDestroyed();
      if (!isCurrent() || account !== await source.sessionAccountScope() || !current.auth.signedIn || current.conversationMode !== "coding" || current.workspace?.root !== request.root || !current.workspace.trusted || current.permissionPreset !== "full-access") throw Error("The account, workspace or permissions changed. Connect again explicitly.");
      const release = await sessions.reserveExternalWorkspace(request.root, owner);
      if (!isCurrent()) { release(); throw Error("The selected session changed before terminal connection."); }
      return { root: request.root, ownerKey: owner, release, isCurrent };
    },
  });
}
async function prepareSessionChange() {
  if (!window || window.isDestroyed() || !await window.webContents.executeJavaScript("globalThis.prepareSessionSwitch?.() ?? false")) throw Error("Save editor changes and finish current commands, queued input or dialogs before switching sessions.");
  await service.stopVoice();
  preview?.dispose(); preview = undefined;
}
function installIPC() {
  const methods = {
    terminalAvailability: () => terminalManager().availability(),
    listExternalAgents: () => discoverExternalAgents(),
    terminalStart: (input: TerminalLaunchRequest) => terminalManager().start(input),
    terminalList: () => terminalManager().list(sessions.snapshot().activeSessionId),
    terminalWrite: (input: { id: string; data: string }) => terminalManager().write(input, sessions.snapshot().activeSessionId),
    terminalClose: (id: string) => terminalManager().close(id, sessions.snapshot().activeSessionId),
    listSessions: () => sessions.listSessions(),
    listSessionApprovals: () => sessions.listSessionApprovals(),
    createSession: async (input: DesktopCreateSessionInput) => { await prepareSessionChange(); return sessions.createSession(input); },
    selectSession: async (id: string) => { await prepareSessionChange(); return sessions.selectSession(id); },
    cancelSession: (id: string) => sessions.cancelSession(id),
    closeSession: async (id: string) => {
      if (id === sessions.snapshot().activeSessionId) await prepareSessionChange();
      await terminals?.closeOwner(id);
      return sessions.closeSession(id);
    },
    setNativeModalOpen: (open: unknown) => {
      if (typeof open !== "boolean") throw Error("Invalid dialog state.");
      nativeModalOpen = open;
      preview?.setSuspended(open);
      voicePanel?.setSuspended(open);
    },
    preview: (input: DesktopPreviewInput) => {
      if (!window || window.isDestroyed()) throw Error("The desktop window is unavailable.");
      if (nativeModalOpen && ["open", "show"].includes(input?.action)) throw Error("Close the current dialog before showing preview.");
      preview ??= new DesktopPreview(window, state => emit({ type: "preview-state", state }));
      preview.setSuspended(nativeModalOpen);
      return preview.command(input);
    },
    appInfo: () => ({ version: app.getVersion(), packaged: app.isPackaged }),
    listPlugins: () => service.listPlugins(),
    previewPlugin: (source: string) => service.previewPlugin(source),
    installReviewedPlugin: (input: Parameters<LocalAgentService["installReviewedPlugin"]>[0]) => service.installReviewedPlugin(input),
    removeInstalledPlugin: (id: string) => service.removeInstalledPlugin(id),
    checkForUpdates: async () => {
      if (!updates) throw Error("Update checks are not ready yet.");
      await updates.check(true);
    },
    discoverTools: (id: string) => service.discoverTools(id),
    toolChoices: () => service.toolChoices(),
    setToolEnabled: (input: Parameters<LocalAgentService["setToolEnabled"]>[0]) => service.setToolEnabled(input),
    accountProfile: () => service.accountProfile(),
    listModels: () => service.listModels(),
    selectModel: (id: string) => service.selectModel(id),
    syncRepository: (action: "status" | "pull") => service.syncRepository(action),
    refreshConversations: () => service.refreshConversations(),
    githubRepositories: () => service.githubRepositories(),
    saveGitHubRepositories: (repositories: Parameters<LocalAgentService["saveGitHubRepositories"]>[0]) => service.saveGitHubRepositories(repositories),
    connectGitHub: async () => { await shell.openExternal(await service.githubInstallURL()); },
    reconnectGitHub: async () => { await openExternal("https://freecoda.com/settings#connections"); },
    readSkill: (id: string) => service.readSkill(id),
    listExtensions: () => service.listExtensions(),
    installExtension: (input: Parameters<LocalAgentService["installExtension"]>[0]) => service.installExtension(input),
    setExtensionEnabled: (input: Parameters<LocalAgentService["setExtensionEnabled"]>[0]) => service.setExtensionEnabled(input),
    removeExtension: (id: string) => service.removeExtension(id),
    setTheme: (theme: unknown) => {
      if (theme !== "system" && theme !== "light" && theme !== "dark")
        throw new Error("Invalid theme.");
      nativeTheme.themeSource = theme;
      window?.setBackgroundColor(
        nativeTheme.shouldUseDarkColors ? "#171522" : "#f6f5fa",
      );
    },
    getState: () => service.getState(),
    getSponsor: () => service.getSponsor(),
    reportSponsorVisible: () => {
      if (window?.isVisible() && !window.isMinimized())
        return service.reportSponsorVisible();
    },
    openSponsor: () => service.openSponsor(),
    openFolder: chooseFolder,
    openRecentFolder,
    trustWorkspace: (
      input: Parameters<LocalAgentService["trustWorkspace"]>[0],
    ) => service.trustWorkspace(input),
    listFiles: () => service.listFiles(),
    readFile: (input: string) => service.readFile(input),
    saveFile: (input: Parameters<LocalAgentService["saveFile"]>[0]) =>
      service.saveFile(input),
    runCommand: (input: Parameters<LocalAgentService["runCommand"]>[0]) =>
      service.runCommand(input),
    runAgent: (input: Parameters<LocalAgentService["runAgent"]>[0]) =>
      service.runAgent(input),
    startVoice: (input: Parameters<LocalAgentService["startVoice"]>[0]) => service.startVoice(input),
    stopVoice: () => service.stopVoice(),
    cancelRun: () => service.cancelRun(),
    suggestPrompt: (input: { prefix: string }) => service.suggestPrompt(input),
    loadComposerDraft: () => service.loadComposerDraft(),
    saveComposerDraft: (input: Parameters<LocalAgentService["saveComposerDraft"]>[0]) => service.saveComposerDraft(input),
    cancelSuggestion: () => service.cancelSuggestion(),
    respondApproval: (
      input: Parameters<LocalAgentService["respondApproval"]>[0],
    ) => service.respondApproval(input),
    login: async () => { await stopTerminals(); return service.login(); },
    logout: async () => { await stopTerminals(); return service.logout(); },
    usage: () => service.usage(),
    setPermissions: (
      preset: Parameters<LocalAgentService["setPermissions"]>[0],
    ) => {
      const owner = sessions.snapshot().activeSessionId;
      const generation = terminalGeneration;
      const epoch = sessionContextEpochs.get(owner);
      return Promise.resolve(terminals?.closeOwner(owner)).then(() => {
        if (owner !== sessions.snapshot().activeSessionId || generation !== terminalGeneration || epoch !== sessionContextEpochs.get(owner)) throw Error("The selected session changed before permissions could be updated.");
        return service.setPermissions(preset);
      });
    },
    createThread: () => service.createThread(),
    setConversationMode: (mode: "chat" | "coding") =>
      service.setConversationMode(mode),
    openThread: (id: string) => service.openThread(id),
    setThreadArchived: (input: { id: string; archived: boolean }) => service.setThreadArchived(input?.id, input?.archived),
    deleteThread: (id: string) => service.deleteThread(id),
    copyText: (value: string) => {
      if (typeof value !== "string" || value.length > 128_000)
        throw Error("Invalid clipboard text.");
      clipboard.writeText(value);
    },
    clearHistory: () => service.clearHistory(),
    openCloud: () => openExternal("https://freecoda.com/app"),
    openAccountSettings: () => openExternal("https://freecoda.com/settings"),
    listCloudWorkspaces: () => service.listCloudWorkspaces(),
    openCloudWorkspace: (id: string) => service.openCloudWorkspace(id),
  };
  for (const [name, handler] of Object.entries(methods)) {
    ipcMain.handle(`desktop:${name}`, async (event, input) => {
      validateSender(event);
      // Renderer arguments have a hard transport limit before operation-specific validation.
      if (JSON.stringify(input ?? null).length > 300_000)
        throw new Error("Desktop request too large.");
      if (contextChangingIPC.has(name)) {
        const owner = sessions.snapshot().activeSessionId;
        sessionContextEpochs.set(owner, (sessionContextEpochs.get(owner) || 0) + 1);
        if (name !== "setPermissions" && terminals?.list(owner).length) throw Error("Close the interactive terminal before changing this session's workspace or conversation.");
      }
      return (handler as (input: unknown) => unknown)(input);
    });
  }
}
function installDevelopmentReload() {
  const marker = process.env.FREECODA_DESKTOP_DEV_RELOAD_FILE;
  if (app.isPackaged || process.env.FREECODA_DESKTOP_DEV !== "1" || !marker) return;
  let revision: unknown;
  try { revision = JSON.parse(readFileSync(marker, "utf8")).revision; } catch { /* First source transform has no update yet. */ }
  let pending: { kind: string; revision: unknown } | undefined;
  let reloading = false;
  const attempt = async () => {
    if (!pending || reloading || quitting || !window || window.isDestroyed() || window.webContents.isLoading()) return;
    reloading = true;
    try {
      const current = await service.getState();
      if (current.running || current.voiceActive || sessions.snapshot().sessions.some(item => ["running", "queued"].includes(item.status)) || sessions.snapshot().sessions.some(item => terminals?.list(item.id).length)) return;
      const safe = await window.webContents.executeJavaScript("globalThis.prepareDevReload?.() ?? false");
      if (!safe) return;
      const change = pending;
      if (change.kind === "main") {
        await service.dispose();
        updates?.dispose();
        quitting = true;
        app.relaunch();
        app.quit();
      } else {
        preview?.dispose(); preview = undefined;
        window.webContents.reload();
      }
      if (pending === change) pending = undefined;
    } catch (error) { console.warn("Source reload deferred:", error instanceof Error ? error.message : "Save work and retry."); }
    finally { reloading = false; }
  };
  watchFile(marker, { interval: 250 }, () => {
    try {
      const change = JSON.parse(readFileSync(marker, "utf8"));
      if (change.revision !== revision && ["renderer", "main"].includes(change.kind)) {
        revision = change.revision;
        pending = { kind: pending?.kind === "main" ? "main" : change.kind, revision };
        void attempt();
      }
    } catch { /* Atomic marker replacement may briefly be unavailable. */ }
  });
  const retry = setInterval(() => { if (pending) void attempt(); }, 1000);
  app.once("will-quit", () => { unwatchFile(marker); clearInterval(retry); });
  console.log("Source hot reload enabled; active work and unsaved editor changes defer reloads.");
}
function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: "Freecoda",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171522" : "#f6f5fa",
    icon: path.join(assetsDirectory, "icon.png"),
    webPreferences: {
      preload: path.join(assetsDirectory, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      navigateOnDragDrop: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppDocument(url)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (tray && !tray.isDestroyed()) window?.hide();
    else app.quit();
  });
  window.on("closed", () => { preview?.dispose(); preview = undefined; window = null; });
  window.once("ready-to-show", () => window?.show());
  void window.loadURL(APP_URL);
}
app
  .whenReady()
  .then(async () => {
    if (!hasLock) return;
    if (process.platform === "darwin") {
      // Keep the app tile within the same visual bounds as neighboring Dock icons.
      const icon = nativeImage.createFromPath(path.join(assetsDirectory, "icon.png"))
        .resize({ width: 440, height: 440, quality: "best" });
      const pixels = icon.toBitmap();
      const canvas = Buffer.alloc(512 * 512 * 4);
      for (let row = 0; row < 440; row++) {
        pixels.copy(canvas, ((row + 36) * 512 + 36) * 4, row * 440 * 4, (row + 1) * 440 * 4);
      }
      app.dock?.setIcon(nativeImage.createFromBitmap(canvas, { width: 512, height: 512 }));
    }
    protocol.handle("freecoda", async (request) => {
      const asset = assetPath(request.url);
      if (!asset || request.method !== "GET")
        return new Response("Not found", { status: 404 });
      const response = await net.fetch(
        pathToFileURL(path.join(assetsDirectory, asset)).toString(),
      );
      const headers = new Headers(response.headers);
      headers.set(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      );
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, { status: response.status, headers });
    });
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    sessions = new DesktopSessionManager({
      dataDirectory: path.join(app.getPath("userData"), "private"),
      emit: event => {
        if (event.type === "auth" && !event.signedIn) { void stopTerminals(); }
        emit(event);
      },
      emitSession: payload => emit({ type: "session-event", ...payload }),
      emitSessions: snapshot => emit({ type: "sessions", snapshot }),
      openExternal,
      openVoiceCompanion: async url => {
        showWindow();
        if (!window) throw Error("The desktop window is unavailable.");
        if (nativeModalOpen) throw Error("Close the current dialog before starting voice.");
        const owner = sessions.currentService();
        voicePanel = await openVoicePanel(window, url, () => { void owner.stopVoice().catch(() => {}); });
        return voicePanel;
      },
    });
    service = sessions.activeService;
    await sessions.initialize();
    installIPC();
    let unsignedMac = false;
    if (app.isPackaged && process.platform === "darwin") {
      try {
        const codesign = promisify(execFile);
        const signature = await codesign(
          "/usr/bin/codesign",
          ["-dv", "--verbose=2", process.execPath],
          { timeout: 5000, maxBuffer: 64 * 1024 },
        );
        if (!/^Authority=Developer ID Application:/m.test(signature.stderr))
          throw new Error("Developer ID required");
        await codesign(
          "/usr/bin/codesign",
          ["--verify", "--strict", process.execPath],
          { timeout: 5000, maxBuffer: 64 * 1024 },
        );
      } catch {
        unsignedMac = true;
      }
    }
    updates = new DesktopUpdates(autoUpdater, {
      packaged: app.isPackaged,
      unavailableReason: unsignedMac
        ? "Automatic updates require a Developer ID-signed macOS build. This build is unsigned. Download the latest installer from freecoda.com/download."
        : undefined,
      notify: (body) => {
        if (Notification.isSupported())
          new Notification({ title: "Freecoda update", body }).show();
      },
      showStatus: async (message, downloaded) => {
        if (!window || window.isDestroyed()) return;
        const { response } = await dialog.showMessageBox(window, {
          type: "info",
          title: "Freecoda updates",
          message,
          buttons: downloaded
            ? ["Keep working", "Quit app to install"]
            : ["OK"],
          defaultId: 0,
          cancelId: 0,
        });
        // Installation requires an explicit quit, with the unsaved-work/task warning.
        if (downloaded && response === 1) app.quit();
        else if (unsignedMac && response === 1)
          await openExternal("https://freecoda.com/download");
      },
    });
    const menu: Electron.MenuItemConstructorOptions[] = [
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      {
        label: "File",
        submenu: [
          {
            label: "Open folder…",
            accelerator: "CmdOrCtrl+O",
            click: () => { if (window && !window.isDestroyed()) void window.webContents.executeJavaScript("document.getElementById(\"open-folder\")?.click()").catch(() => {}); },
          },
          {
            label: "Cloud workspace",
            click: () => void openExternal("https://freecoda.com/app"),
          },
          { type: "separator" },
          { role: "quit", accelerator: "CmdOrCtrl+Q" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
      {
        label: "Help",
        submenu: [
          {
            label: "Check for updates…",
            click: () => void updates?.check(true),
          },
          { label: "Update status…", click: () => void updates?.status() },
          { type: "separator" },
          {
            label: "Freecoda documentation",
            click: () => void openExternal("https://freecoda.com/docs"),
          },
          {
            label: "About Freecoda",
            click: () =>
              void dialog.showMessageBox({
                title: "Freecoda",
                message: `Freecoda ${app.getVersion()}`,
                detail:
                  "Free forever. Supported by direct sponsors.\nLocal coding with explicit approvals.",
              }),
          },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
    createWindow();
    installTray();
    installDevelopmentReload();
    updates.start();
  })
  .catch((error) => {
    console.error(
      "Desktop startup failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    quitting = true;
    updates?.dispose();
    app.quit();
  });
app.on("before-quit", (event) => {
  if (!service || quitting) return;
  event.preventDefault();
  void confirmQuit();
});
app.on("will-quit", () => {
  tray?.destroy();
  tray = null;
});
app.on("window-all-closed", () => {
  if (!quitting && (!tray || tray.isDestroyed())) app.quit();
});
