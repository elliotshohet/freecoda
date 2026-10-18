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
export type DesktopState = {
  workspace: DesktopWorkspace | null;
  recentFolders: { root: string; name: string; trusted: boolean }[];
  auth: { signedIn: boolean; server: string; model?: string };
  running: boolean;
  permissionPreset: DesktopPermissionPreset;
  conversationMode: "chat" | "coding";
  threads?: { id: string; title: string; updatedAt: string }[];
  activeThreadId?: string;
  conversation?: { role: "user" | "assistant"; text: string }[];
};
export type DesktopEvent =
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
export interface DesktopBridge {
  getSponsor(): Promise<DesktopSponsor>;
  reportSponsorVisible(): Promise<void>;
  openSponsor(): Promise<void>;
  setPermissions(preset: DesktopPermissionPreset): Promise<DesktopState>;
  setConversationMode(mode: "chat" | "coding"): Promise<DesktopState>;
  setTheme(theme: "system" | "light" | "dark"): Promise<void>;
  getState(): Promise<DesktopState>;
  openFolder(): Promise<DesktopWorkspace | null>;
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
  respondApproval(
    input: DesktopApprovalResponse,
  ): Promise<{ accepted: boolean }>;
  login(): Promise<DesktopLogin>;
  logout(): Promise<void>;
  usage(): Promise<unknown>;
  clearHistory(): Promise<void>;
  createThread(): Promise<DesktopState>;
  openThread(id: string): Promise<DesktopState>;
  deleteThread(id: string): Promise<DesktopState>;
  copyText(value: string): Promise<void>;
  openCloud(): Promise<void>;
  onEvent(listener: (event: DesktopEvent) => void): () => void;
}
