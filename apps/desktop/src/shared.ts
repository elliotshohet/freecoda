export type AgentMode = "chat" | "build" | "plan" | "review";
export type DesktopPermissionPreset = "read-only" | "default" | "full-access";
export type ApprovalKind = "write" | "shell";
export type DesktopFileEntry = { path: string; type: "file" };
export type DesktopWorkspace = {
  root: string;
  name: string;
  trusted: boolean;
  files: DesktopFileEntry[];
};
export type DesktopFile = {
  path: string;
  content: string;
  hash: string;
  readOnly: boolean;
};
export type DesktopCommandResult = { output: string; exitCode: number | null };
export type DesktopLogin = {
  loginId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
};
export type DesktopCloudWorkspace = {
  id: string;
  name: string;
  repository: string | null;
  status: string;
  appDirectory?: string;
  branch?: string;
};

export type DesktopState = {
  workspace: DesktopWorkspace | null;
  recentFolders: { root: string; name: string; trusted: boolean }[];
  auth: { signedIn: boolean; server: string; model?: string; allowPromptTraining?: boolean };
  running: boolean;
  voiceActive?: boolean;
  permissionPreset: DesktopPermissionPreset;
  conversationMode: "chat" | "coding";
  threads?: { id: string; title: string; updatedAt: string; archived?: boolean }[];
  activeThreadId?: string;
  composerDraftKey?: string;
  conversation?: { role: "user" | "assistant"; text: string }[];
};
export type DesktopEvent =
  | { type: "composer-scope-migrated"; from: string; to: string }
  | { type: "voice-dictation"; text: string; scope: string }
  | { type: "voice-turn"; text: string; scope: string }
  | { type: "voice-status"; active: boolean; text: string }
  | { type: "state"; state: DesktopState }
  | { type: "run-started"; runId: string }
  | { type: "text-delta"; runId: string; text: string }
  | { type: "tool-start"; runId: string; name: string }
  | { type: "tool-result"; runId: string; name: string; result: unknown }
  | {
      type: "approval";
      id: string;
      runId?: string;
      kind: ApprovalKind;
      description: string;
    }
  | { type: "approval-resolved"; id: string; approved: boolean }
  | { type: "output"; text: string; exitCode?: number | null }
  | { type: "done"; runId: string; text: string; cancelled?: boolean }
  | { type: "error"; runId?: string; text: string }
  | { type: "auth"; signedIn: boolean; message: string };
export type DesktopApprovalResponse = {
  id: string;
  approved: boolean;
  scope: "once" | "session";
};
export type DesktopRunInput = { prompt: string; mode: AgentMode };
export type DesktopSaveInput = {
  path: string;
  content: string;
  expectedHash: string | null;
};
export type DesktopSponsor = {
  label: string;
  headline: string;
  description: string;
  paid: boolean;
};
export type DesktopGitHubRepo = { repositoryId: number; installationId: number; owner: string; name: string; defaultBranch: string; private: boolean };
export type DesktopGitHubPreference = { repositoryId: number; installationId: number; owner: string; name: string; branch: string; appDirectory: string; enabled: boolean };
export type DesktopGitHubState = { repos: DesktopGitHubRepo[]; repositories: DesktopGitHubPreference[]; canInstall: boolean };
export type DesktopExtension = { id: string; name: string; kind: "skill" | "mcp"; enabled: boolean };
export type DesktopPlugin = { id: string; name: string; skillCount: number; serverCount: number };
export interface DesktopBridge {
  appInfo(): Promise<{ version: string; packaged: boolean }>;
  listPlugins(): Promise<DesktopPlugin[]>;
  previewPlugin(source: string): Promise<import("../../../packages/contracts/src/extensions").PluginManifest>;
  installReviewedPlugin(input: { source: string; manifest: import("../../../packages/contracts/src/extensions").PluginManifest }): Promise<DesktopPlugin[]>;
  removeInstalledPlugin(id: string): Promise<DesktopPlugin[]>;
  checkForUpdates(): Promise<void>;
  discoverTools(id: string): Promise<string[]>;
  toolChoices(): Promise<{ name: string; enabled: boolean }[]>;
  setToolEnabled(input: { name: string; enabled: boolean }): Promise<{ name: string; enabled: boolean }[]>;
  accountProfile(): Promise<{ name?: string; avatar?: string }>;
  listModels(): Promise<{ id: string; name: string }[]>;
  selectModel(id: string): Promise<DesktopState>;
  syncRepository(action: "status" | "pull"): Promise<import("../../../packages/core/src/git-sync").RepositorySyncStatus>;
  refreshConversations(): Promise<DesktopState>;
  githubRepositories(): Promise<DesktopGitHubState>;
  saveGitHubRepositories(repositories: DesktopGitHubPreference[]): Promise<DesktopGitHubState>;
  connectGitHub(): Promise<void>;
  reconnectGitHub(): Promise<void>;
  readSkill(id: string): Promise<{ id: string; name: string; instructions: string }>;
  listExtensions(): Promise<DesktopExtension[]>;
  installExtension(input: { kind: "skill" | "mcp"; name: string; url: string }): Promise<DesktopExtension[]>;
  setExtensionEnabled(input: { id: string; enabled: boolean }): Promise<DesktopExtension[]>;
  removeExtension(id: string): Promise<DesktopExtension[]>;
  getSponsor(): Promise<DesktopSponsor>;
  reportSponsorVisible(): Promise<void>;
  openSponsor(): Promise<void>;
  setPermissions(preset: DesktopPermissionPreset): Promise<DesktopState>;
  setConversationMode(mode: "chat" | "coding"): Promise<DesktopState>;
  setTheme(theme: "system" | "light" | "dark"): Promise<void>;
  getState(): Promise<DesktopState>;
  openFolder(): Promise<DesktopWorkspace | null>;
  openRecentFolder(root: string): Promise<DesktopWorkspace | null>;
  trustWorkspace(input: {
    root: string;
    consent: true;
  }): Promise<DesktopWorkspace>;
  listFiles(): Promise<DesktopFileEntry[]>;
  readFile(path: string): Promise<DesktopFile>;
  saveFile(input: DesktopSaveInput): Promise<DesktopFile>;
  runCommand(input: { command: string }): Promise<DesktopCommandResult>;
  runAgent(input: DesktopRunInput): Promise<{ runId: string }>;
  cancelRun(): Promise<void>;
  startVoice(input: { mode: "dictation" | "conversation"; agentMode: DesktopRunInput["mode"] }): Promise<void>;
  stopVoice(): Promise<void>;
  suggestPrompt(input: { prefix: string }): Promise<{ suggestion: string }>;
  cancelSuggestion(): Promise<void>;
  loadComposerDraft(): Promise<{ key: string; text: string; revision: number }>;
  saveComposerDraft(input: { key: string; text: string; revision: number }): Promise<{ saved: boolean }>;
  respondApproval(
    input: DesktopApprovalResponse,
  ): Promise<{ accepted: boolean }>;
  login(): Promise<DesktopLogin>;
  logout(): Promise<void>;
  usage(): Promise<unknown>;
  clearHistory(): Promise<void>;
  createThread(): Promise<DesktopState>;
  openThread(id: string): Promise<DesktopState>;
  setThreadArchived(id: string, archived: boolean): Promise<DesktopState>;
  deleteThread(id: string): Promise<DesktopState>;
  copyText(value: string): Promise<void>;
  openCloud(): Promise<void>;
  openAccountSettings(): Promise<void>;
  listCloudWorkspaces(): Promise<DesktopCloudWorkspace[]>;
  openCloudWorkspace(id: string): Promise<void>;
  onEvent(listener: (event: DesktopEvent) => void): () => void;
}
