import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
import type { ModelMessage } from "ai";
import { historyFile, savePrivate, stateDir } from "./config";

export type Conversation = {
  id: string;
  root: string;
  title: string;
  updatedAt: string;
  messages: ModelMessage[];
};
const validId = (value: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    value,
  );
const directory = (root: string) =>
  path.join(
    stateDir(),
    "threads",
    createHash("sha256").update(root).digest("hex"),
  );
export function newConversation(root: string): Conversation {
  return {
    id: randomUUID(),
    root,
    title: "New task",
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}
async function readConversation(
  filename: string,
  root: string,
): Promise<Conversation | null> {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 20 * 1024 * 1024)
    throw Error("Invalid local task file.");
  const value = JSON.parse(await readFile(filename, "utf8"));
  if (
    value.root !== root ||
    !Array.isArray(value.messages) ||
    value.messages.some(
      (item: any) =>
        !item || !["user", "assistant", "tool", "system"].includes(item.role),
    )
  )
    throw Error("Invalid local task history.");
  return {
    ...newConversation(root),
    ...value,
    id: validId(value.id ?? "") ? value.id : randomUUID(),
    title: typeof value.title === "string" ? value.title : "New task",
    updatedAt:
      typeof value.updatedAt === "string" &&
      Number.isFinite(Date.parse(value.updatedAt))
        ? value.updatedAt
        : info.mtime.toISOString(),
  };
}
export async function loadConversation(
  root: string,
  id?: string,
): Promise<Conversation> {
  if (id && !validId(id)) throw Error("Invalid task ID.");
  try {
    return (await readConversation(
      id ? path.join(directory(root), `${id}.json`) : historyFile(root),
      root,
    ))!;
  } catch (error) {
    if (!id && (error as NodeJS.ErrnoException).code === "ENOENT")
      return newConversation(root);
    throw error;
  }
}
export async function saveConversation(conversation: Conversation) {
  if (!validId(conversation.id)) throw Error("Invalid task ID.");
  const first = conversation.messages.find(
    (message) => message.role === "user",
  );
  const text =
    typeof first?.content === "string"
      ? first.content
      : first?.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(" ");
  const saved = {
    ...conversation,
    title: (text || conversation.title)
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .slice(0, 100),
    updatedAt: new Date().toISOString(),
  };
  await savePrivate(
    path.join(directory(conversation.root), `${conversation.id}.json`),
    saved,
  );
  await savePrivate(historyFile(conversation.root), saved);
  return saved;
}
export async function listConversations(root: string) {
  let entries: string[];
  try {
    const info = await lstat(directory(root));
    if (info.isSymbolicLink() || !info.isDirectory())
      throw Error("Invalid local tasks directory.");
    entries = await readdir(directory(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const result: Pick<Conversation, "id" | "title" | "updatedAt">[] = [];
  for (const entry of entries
    .filter(
      (name) => validId(name.replace(/\.json$/, "")) && name.endsWith(".json"),
    )
    .slice(0, 500)) {
    const item = await readConversation(
      path.join(directory(root), entry),
      root,
    );
    if (item)
      result.push({
        id: item.id,
        title: item.title,
        updatedAt: item.updatedAt,
      });
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function clearConversations(root: string) {
  try {
    const info = await lstat(directory(root));
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error("Invalid local tasks directory.");
    await rm(directory(root), { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await unlink(historyFile(root)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
