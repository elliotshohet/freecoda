import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopEvent } from "./shared";
// Expose individual operations, never raw IPC or Node APIs.
const api: DesktopBridge = {
  refreshConversations: () => ipcRenderer.invoke("desktop:refreshConversations"),
  githubRepositories: () => ipcRenderer.invoke("desktop:githubRepositories"),
  saveGitHubRepositories: (repositories) => ipcRenderer.invoke("desktop:saveGitHubRepositories", repositories),
  connectGitHub: () => ipcRenderer.invoke("desktop:connectGitHub"),
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
  trustWorkspace: (input) =>
    ipcRenderer.invoke("desktop:trustWorkspace", input),
  listFiles: () => ipcRenderer.invoke("desktop:listFiles"),
  readFile: (path) => ipcRenderer.invoke("desktop:readFile", path),
  saveFile: (input) => ipcRenderer.invoke("desktop:saveFile", input),
  runCommand: (input) => ipcRenderer.invoke("desktop:runCommand", input),
  runAgent: (input) => ipcRenderer.invoke("desktop:runAgent", input),
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
  deleteThread: (id) => ipcRenderer.invoke("desktop:deleteThread", id),
  copyText: (value) => ipcRenderer.invoke("desktop:copyText", value),
  clearHistory: () => ipcRenderer.invoke("desktop:clearHistory"),
  openCloud: () => ipcRenderer.invoke("desktop:openCloud"),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, data: DesktopEvent) =>
      listener(data);
    ipcRenderer.on("desktop:event", handler);
    return () => ipcRenderer.removeListener("desktop:event", handler);
  },
};
contextBridge.exposeInMainWorld("freecoda", Object.freeze(api));
