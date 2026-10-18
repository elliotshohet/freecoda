import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, stat, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { historyFile, savePrivate } from "../packages/cli/src/config";
import {
  conversationScope,
  newConversation,
  saveConversation,
  loadConversation,
  listConversations,
  clearConversations,
} from "../packages/cli/src/threads";

test("saved CLI tasks survive new conversations, migrate legacy history, and stay scoped to the trusted project", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-threads-"));
  const previous = process.env.FREECODA_CONFIG_DIR;
  process.env.FREECODA_CONFIG_DIR = directory;
  try {
    const root = path.join(directory, "project"),
      other = path.join(directory, "other");
    await savePrivate(historyFile(root), {
      root,
      messages: [{ role: "user", content: "Fix the parser" }],
    });
    const legacy = await loadConversation(root);
    await saveConversation(legacy);
    const fresh = await saveConversation(newConversation(root));
    expect((await loadConversation(root)).id).toBe(fresh.id);
    expect((await loadConversation(root, legacy.id)).messages).toEqual(
      legacy.messages,
    );
    expect(
      (await listConversations(root)).map((item) => item.id).sort(),
    ).toEqual([legacy.id, fresh.id].sort());
    expect(await listConversations(other)).toEqual([]);
    await expect(loadConversation(other, legacy.id)).rejects.toThrow();
    await expect(loadConversation(root, "../../config")).rejects.toThrow(
      "Invalid task ID",
    );
    const filename = path.join(
      directory,
      "threads",
      createHash("sha256").update(root).digest("hex"),
      legacy.id + ".json",
    );
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
    await rm(filename);
    await symlink(historyFile(root), filename);
    await expect(loadConversation(root, legacy.id)).rejects.toThrow(
      "Invalid local task file",
    );
    await rm(filename);
    expect(JSON.parse(await readFile(historyFile(root), "utf8")).id).toBe(
      fresh.id,
    );
    const otherTask = await saveConversation(newConversation(other));
    await mkdir(other, { recursive: true });
    await mkdir(root, { recursive: true });
    const clear = Bun.spawn(
      [
        process.execPath,
        path.resolve("packages/cli/src/index.ts"),
        "--cwd",
        other,
        "history",
        "clear",
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const code = await clear.exited;
    expect(code).toBe(0);
    expect((await loadConversation(other)).messages).toEqual([]);
    expect((await loadConversation(root)).id).toBe(fresh.id);
    await saveConversation(otherTask);
    expect((await listConversations(root))[0]).not.toHaveProperty("messages");
    await clearConversations(root);
    expect(await listConversations(root)).toEqual([]);
    expect((await loadConversation(other)).id).toBe(otherTask.id);
    expect((await loadConversation(root)).messages).toEqual([]);
  } finally {
    if (previous === undefined) delete process.env.FREECODA_CONFIG_DIR;
    else process.env.FREECODA_CONFIG_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("general chat history never loads coding messages or legacy task context", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-chat-scope-"));
  const previous = process.env.FREECODA_CONFIG_DIR;
  process.env.FREECODA_CONFIG_DIR = directory;
  try {
    const root = path.join(directory, "project"),
      chat = conversationScope(root, "chat");
    expect(conversationScope(root, "build")).toBe(root);
    const coding = await saveConversation({
      ...newConversation(root),
      messages: [{ role: "user", content: "PRIVATE_REPOSITORY_CONTEXT" }],
    });
    expect((await loadConversation(chat)).messages).toEqual([]);
    expect(await listConversations(chat)).toEqual([]);
    await expect(loadConversation(chat, coding.id)).rejects.toThrow();
    const general = await saveConversation({
      ...newConversation(chat),
      messages: [{ role: "user", content: "Explain rainbows" }],
    });
    expect((await loadConversation(root)).id).toBe(coding.id);
    expect((await loadConversation(chat)).id).toBe(general.id);
  } finally {
    if (previous === undefined) delete process.env.FREECODA_CONFIG_DIR;
    else process.env.FREECODA_CONFIG_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
