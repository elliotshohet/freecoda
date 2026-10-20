import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopEvent } from "./shared";
// Expose individual operations, never raw IPC or Node APIs.
const api: DesktopBridge = {
  appInfo: () => ipcRenderer.invoke("desktop:appInfo"),
  listPlugins: () => ipcRenderer.invoke("desktop:listPlugins"),
  previewPlugin: (source) => ipcRenderer.invoke("desktop:previewPlugin", source),
  installReviewedPlugin: (input) => ipcRenderer.invoke("desktop:installReviewedPlugin", input),
  removeInstalledPlugin: (id) => ipcRenderer.invoke("desktop:removeInstalledPlugin", id),
  checkForUpdates: () => ipcRenderer.invoke("desktop:checkForUpdates"),
  discoverTools: (id) => ipcRenderer.invoke("desktop:discoverTools", id),
  toolChoices: () => ipcRenderer.invoke("desktop:toolChoices"),
  setToolEnabled: (input) => ipcRenderer.invoke("desktop:setToolEnabled", input),
  accountProfile: () => ipcRenderer.invoke("desktop:accountProfile"),
  listModels: () => ipcRenderer.invoke("desktop:listModels"),
  selectModel: (id) => ipcRenderer.invoke("desktop:selectModel", id),
  syncRepository: (action) => ipcRenderer.invoke("desktop:syncRepository", action),
  refreshConversations: () => ipcRenderer.invoke("desktop:refreshConversations"),
  githubRepositories: () => ipcRenderer.invoke("desktop:githubRepositories"),
  saveGitHubRepositories: (repositories) => ipcRenderer.invoke("desktop:saveGitHubRepositories", repositories),
  connectGitHub: () => ipcRenderer.invoke("desktop:connectGitHub"),
  reconnectGitHub: () => ipcRenderer.invoke("desktop:reconnectGitHub"),
  readSkill: (id) => ipcRenderer.invoke("desktop:readSkill", id),
  listExtensions: () => ipcRenderer.invoke("desktop:listExtensions"),
  installExtension: (input) => ipcRenderer.invoke("desktop:installExtension", input),
  setExtensionEnabled: (input) => ipcRenderer.invoke("desktop:setExtensionEnabled", input),
  removeExtension: (id) => ipcRenderer.invoke("desktop:removeExtension", id),
  getSponsor: () => ipcRenderer.invoke("desktop:getSponsor"),
  reportSponsorVisible: () =>
    ipcRenderer.invoke("desktop:reportSponsorVisible"),
  openSponsor: () => ipcRenderer.invoke("desktop:openSponsor"),
  setTheme: (theme) => ipcRenderer.invoke("desktop:setTheme", theme),
  getState: () => ipcRenderer.invoke("desktop:getState"),
  openFolder: () => ipcRenderer.invoke("desktop:openFolder"),
  openRecentFolder: (root) => ipcRenderer.invoke("desktop:openRecentFolder", root),
  trustWorkspace: (input) =>
    ipcRenderer.invoke("desktop:trustWorkspace", input),
  listFiles: () => ipcRenderer.invoke("desktop:listFiles"),
  readFile: (path) => ipcRenderer.invoke("desktop:readFile", path),
  saveFile: (input) => ipcRenderer.invoke("desktop:saveFile", input),
  runCommand: (input) => ipcRenderer.invoke("desktop:runCommand", input),
  runAgent: (input) => ipcRenderer.invoke("desktop:runAgent", input),
  suggestPrompt: (input) => ipcRenderer.invoke("desktop:suggestPrompt", input),
  loadComposerDraft: () => ipcRenderer.invoke("desktop:loadComposerDraft"),
  saveComposerDraft: (input) => ipcRenderer.invoke("desktop:saveComposerDraft", input),
  cancelSuggestion: () => ipcRenderer.invoke("desktop:cancelSuggestion"),
  startVoice: (input) => ipcRenderer.invoke("desktop:startVoice", input),
  stopVoice: () => ipcRenderer.invoke("desktop:stopVoice"),
  cancelRun: () => ipcRenderer.invoke("desktop:cancelRun"),
  respondApproval: (input) =>
    ipcRenderer.invoke("desktop:respondApproval", input),
  login: () => ipcRenderer.invoke("desktop:login"),
  logout: () => ipcRenderer.invoke("desktop:logout"),
  usage: () => ipcRenderer.invoke("desktop:usage"),
  setPermissions: (preset) =>
    ipcRenderer.invoke("desktop:setPermissions", preset),
  createThread: () => ipcRenderer.invoke("desktop:createThread"),
  setConversationMode: (mode) =>
    ipcRenderer.invoke("desktop:setConversationMode", mode),
  openThread: (id) => ipcRenderer.invoke("desktop:openThread", id),
  setThreadArchived: (id, archived) => ipcRenderer.invoke("desktop:setThreadArchived", { id, archived }),
  deleteThread: (id) => ipcRenderer.invoke("desktop:deleteThread", id),
  copyText: (value) => ipcRenderer.invoke("desktop:copyText", value),
  clearHistory: () => ipcRenderer.invoke("desktop:clearHistory"),
  openCloud: () => ipcRenderer.invoke("desktop:openCloud"),
  openAccountSettings: () => ipcRenderer.invoke("desktop:openAccountSettings"),
  listCloudWorkspaces: () => ipcRenderer.invoke("desktop:listCloudWorkspaces"),
  openCloudWorkspace: (id) => ipcRenderer.invoke("desktop:openCloudWorkspace", id),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, data: DesktopEvent) =>
      listener(data);
    ipcRenderer.on("desktop:event", handler);
    return () => ipcRenderer.removeListener("desktop:event", handler);
  },
};
contextBridge.exposeInMainWorld("freecoda", Object.freeze(api));
