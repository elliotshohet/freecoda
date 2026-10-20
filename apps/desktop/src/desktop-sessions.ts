import type { DesktopEvent } from "./shared";

export type DesktopSessionStatus = "idle" | "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type DesktopSessionSummary = {
  id: string;
  title: string;
  root: string | null;
  conversationMode: "chat" | "coding";
  status: DesktopSessionStatus;
  runId?: string;
  updatedAt: string;
  pendingApprovals: number;
  restored?: boolean;
};
export type DesktopSessionSnapshot = { activeSessionId: string; sessions: DesktopSessionSummary[] };
export type DesktopSessionEvent = { sessionId: string; event: DesktopEvent };
export type DesktopCreateSessionInput = { root?: string; mode?: "chat" | "coding"; title?: string };
