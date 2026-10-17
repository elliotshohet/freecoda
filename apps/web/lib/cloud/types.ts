export type SourceFile = {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
  mode?: "100644" | "100755";
};
export type RepositorySource = {
  installationId: number;
  owner: string;
  name: string;
  defaultBranch: string;
  baseSha: string;
  repositoryId: number;
  baseFiles: SourceFile[];
};
export type CloudProject = {
  id: string;
  userId: string;
  name: string;
  status: "creating" | "ready" | "suspended" | "failed" | "deleted";
  sandboxId: string | null;
  snapshotId: string | null;
  appDirectory: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  error?: string;
  repo?: Omit<RepositorySource, "baseFiles">;
};
export type ProjectPayload = {
  error?: string;
  files: SourceFile[];
  repository?: RepositorySource;
  consentAt: string;
  preview?: { url: string; token: string; expiresAt: string };
};
export type CloudRun = {
  id: string;
  projectId: string;
  userId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  workflowId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type RunPayload = {
  prompt: string;
  mode: "build" | "plan" | "review";
  consentAt: string;
  turn?: number;
  messages?: import("ai").ModelMessage[];
};
export type CloudEvent = {
  id: number;
  type: string;
  data: unknown;
  createdAt: string;
};
