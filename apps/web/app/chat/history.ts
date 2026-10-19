/** Browser-local chat data. Request limits are enforced separately from storage. */
export type Message = {
  role: "user" | "assistant";
  content: string;
  status?: "complete" | "partial" | "stopped" | "error";
};
export type Conversation = {
  mode?: "chat" | "coding";
  cloudVersion?: number;
  cloudDirty?: boolean;
  cloudDeleted?: boolean;
  cloudLoaded?: boolean;
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
      ...(candidate.mode === "coding" ? { mode: "coding" as const } : {}),
      ...(Number.isSafeInteger(candidate.cloudVersion) && Number(candidate.cloudVersion) > 0 ? { cloudVersion: Number(candidate.cloudVersion) } : {}),
      ...(candidate.cloudDirty === true ? { cloudDirty: true } : {}),
      ...(candidate.cloudDeleted === true ? { cloudDeleted: true } : {}),
      ...(candidate.cloudLoaded === false ? { cloudLoaded: false } : {}),
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

/** Compact only completed earlier turns; preserve the current user request and displayed history. */
export function boundedChatContext(
  messages: Pick<Message, "role" | "content">[],
  maxBytes = 80_000,
  maxMessages = 40,
) {
  let context = [...messages];
  const size = () => new TextEncoder().encode(JSON.stringify(context)).byteLength;
  while (size() > maxBytes || context.length > maxMessages) {
    const nextTurn = context.findIndex(
      (message, index) => index > 0 && message.role === "user",
    );
    if (nextTurn < 0) return null;
    context = context.slice(nextTurn);
  }
  return context;
}
