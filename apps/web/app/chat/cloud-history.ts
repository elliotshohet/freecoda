import { type Conversation, type Message } from "./history";
type CloudMessage = { role: string; content: unknown; status?: Message["status"] };
export type CloudConversation = { id: string; title: string; mode: "chat" | "coding"; messages: CloudMessage[]; updatedAt: string; version: number };
export function displayCloudConversation(record: CloudConversation): Conversation {
  const messages: Message[] = [];
  for (const message of record.messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = typeof message.content === "string" ? message.content : Array.isArray(message.content)
      ? message.content.filter(part => part && typeof part === "object" && part.type === "text" && typeof part.text === "string").map(part => part.text).join("\n") : "";
    if (content) messages.push({ role: message.role, content, status: message.status || "complete" });
  }
  return { id: record.id, title: record.title, mode: record.mode, messages, updatedAt: Date.parse(record.updatedAt), cloudVersion: record.version, cloudDirty: false };
}
export function cloudConversationBody(chat: Conversation) {
  if (chat.mode === "coding" || chat.cloudDeleted || chat.cloudLoaded === false)
    throw Error("Open this conversation in its coding client; read-only cloud history cannot be overwritten from chat.");
  return { title: chat.title.slice(0, 160), mode: "chat" as const, messages: chat.messages.map(({ role, content, status }) => ({ role, content, ...(status ? { status } : {}) })), expectedVersion: chat.cloudVersion ?? null };
}
export class ConversationHttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function conversationRequest(path = "", method = "GET", body?: unknown, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(`/api/v1/conversations${path}`, { method, cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const value = await response.json().catch(() => ({ error: `Conversation service returned ${response.status}. Try syncing again.` }));
  if (!response.ok) throw new ConversationHttpError(value.error || "Conversation cloud sync is unavailable.", response.status);
  return value;
}
export async function cloudHistory(userId: string, signal?: AbortSignal): Promise<Conversation[]> {
  const summaries: Omit<CloudConversation, "messages">[] = [];
  for (const mode of ["chat", "coding"]) {
    let cursor: string | null = null;
    do {
      const page = await conversationRequest(`?mode=${mode}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "GET", undefined, signal);
      if (page.userId !== userId) throw Error("Your signed-in account changed. Reload before syncing conversations.");
      summaries.push(...page.conversations); cursor = page.nextCursor;
    } while (cursor);
  }
  return summaries.map(summary => ({ id: summary.id, title: summary.title, mode: summary.mode,
    updatedAt: Date.parse(summary.updatedAt), cloudVersion: summary.version, cloudDirty: false,
    cloudLoaded: false, messages: [] }));
}
