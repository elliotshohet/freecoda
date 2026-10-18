/** Browser-local chat data. Request limits are enforced separately from storage. */
export type Message = {
  role: "user" | "assistant";
  content: string;
  status?: "complete" | "partial" | "stopped" | "error";
};
export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
};
const statuses = new Set(["complete", "partial", "stopped", "error"]);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function validChats(value: unknown): Conversation[] {
  if (!Array.isArray(value)) return [];
  const chats: Conversation[] = [];
  const ids = new Set<string>();
  let totalBytes = 0;
  for (const candidate of value.slice(0, 200)) {
    if (chats.length >= 80) break;
    if (
      !record(candidate) ||
      typeof candidate.id !== "string" ||
      !candidate.id ||
      candidate.id.length > 200 ||
      ids.has(candidate.id) ||
      typeof candidate.title !== "string" ||
      candidate.title.length > 200 ||
      typeof candidate.updatedAt !== "number" ||
      !Number.isFinite(candidate.updatedAt) ||
      !Array.isArray(candidate.messages) ||
      candidate.messages.length > 200
    )
      continue;
    const messages: Message[] = [];
    let bytes = 0;
    let valid = true;
    for (const message of candidate.messages) {
      if (
        !record(message) ||
        (message.role !== "user" && message.role !== "assistant") ||
        typeof message.content !== "string" ||
        message.content.length > (message.role === "user" ? 8000 : 64000) ||
        (message.status !== undefined &&
          (typeof message.status !== "string" || !statuses.has(message.status)))
      ) {
        valid = false;
        break;
      }
      bytes += new TextEncoder().encode(message.content).byteLength;
      if (bytes > 4_000_000) {
        valid = false;
        break;
      }
      messages.push({
        role: message.role,
        content: message.content,
        ...(message.status === undefined
          ? {}
          : { status: message.status as Message["status"] }),
      });
    }
    if (!valid || totalBytes + bytes > 4_000_000) continue;
    totalBytes += bytes;
    ids.add(candidate.id);
    chats.push({
      id: candidate.id,
      title: candidate.title,
      messages,
      updatedAt: candidate.updatedAt,
    });
  }
  return chats;
}

/** Partial replies stay visible in history but never become trusted continuation context. */
export function chatContext(
  messages: Message[],
): Pick<Message, "role" | "content">[] {
  return messages
    .filter(
      (message) =>
        message.content.trim() &&
        (message.role === "user" ||
          message.status === undefined ||
          message.status === "complete"),
    )
    .map(({ role, content }) => ({ role, content }));
}
