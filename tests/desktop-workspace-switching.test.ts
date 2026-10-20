import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalAgentService } from "../apps/desktop/src/local-agent";

test("workspace and chat switching restore local selections without waiting for cloud transport", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "freecoda-switch-"));
  const directory = await realpath(temporary);
  const data = path.join(directory, "data");
  const roots = [path.join(directory, "first"), path.join(directory, "second")];
  for (const root of [data, ...roots, path.join(data, "sessions")]) await mkdir(root, { recursive: true });
  const server = "https://freecoda.com", accountId = "workspace-account";
  await writeFile(path.join(data, "desktop.json"), JSON.stringify({ server, token: "a".repeat(40), accountId, trustedRoots: roots, recentRoots: roots }));
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const scopes = [...roots, "freecoda:general-chat"];
  const filename = (scope: string) => path.join(data, "sessions", createHash("sha256").update(scope).digest("hex") + ".json");
  for (const [index, scope] of scopes.entries()) {
    await writeFile(filename(scope), JSON.stringify({ root: scope, activeThreadId: ids[index], threads: [{ id: ids[index], title: `Saved ${index}`, messages: [{ role: "user", content: `History ${index}` }], updatedAt: new Date().toISOString(), cloudOwner: accountId }] }));
  }
  let blocked = false, calls = 0;
  let release!: () => void, contacted!: () => void;
  const networkGate = new Promise<void>(resolve => { release = resolve; });
  const networkStarted = new Promise<void>(resolve => { contacted = resolve; });
  const service = new LocalAgentService({ dataDirectory: data, emit() {}, async openExternal() {}, async fetch(input, init) {
    calls++;
    if (blocked) { contacted(); await networkGate; }
    if (init?.method === "PUT") return Response.json({ conversation: { version: 1 } });
    return Response.json({ userId: accountId, conversations: [], nextCursor: null });
  } });
  try {
    await service.getState();
    const initialCalls = calls;
    blocked = true;
    // The competing promise detects a network dependency without timing thresholds.
    const switched = service.selectWorkspace(roots[0]);
    expect(await Promise.race([switched.then(() => "local"), networkStarted.then(() => "network")])).toBe("local");
    await switched;
    expect((await service.getState()).activeThreadId).toBe(ids[0]);
    await service.selectWorkspace(roots[1]);
    expect((await service.getState()).conversation?.[0]?.text).toBe("History 1");
    await service.selectWorkspace(roots[0]);
    expect((await service.getState()).activeThreadId).toBe(ids[0]);
    await service.setConversationMode("chat");
    expect((await service.getState()).activeThreadId).toBe(ids[2]);
    await service.setConversationMode("coding");
    expect((await service.getState()).activeThreadId).toBe(ids[0]);
    expect(calls).toBe(initialCalls);
    const oldScope = JSON.parse(await readFile(filename(roots[1]), "utf8"));
    expect(oldScope.root).toBe(roots[1]);
    expect(oldScope.threads[0].messages[0].content).toBe("History 1");
    const refreshing = service.refreshConversations();
    await networkStarted;
    expect(calls).toBeGreaterThan(initialCalls);
    release();
    await refreshing;
  } finally {
    release();
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("open workspaces persist independently of recent-folder eviction and retain picker authorization", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "freecoda-open-workspaces-")));
  const data = path.join(directory, "data");
  const roots = Array.from({ length: 13 }, (_, index) => path.join(directory, `workspace-${index}`));
  for (const root of roots) await mkdir(root);
  const options = { dataDirectory: data, emit() {}, async openExternal() {} };
  let service = new LocalAgentService(options);
  try {
    for (const root of roots) await service.selectWorkspace(root);
    const opened = await service.getState();
    expect(opened.openFolders.map(folder => folder.root)).toEqual(roots);
    expect(opened.openFolders.every(folder => !folder.trusted)).toBe(true);
    expect(opened.recentFolders).toHaveLength(12);
    expect(opened.recentFolders.some(folder => folder.root === roots[0])).toBe(false);
    await service.dispose();
    service = new LocalAgentService(options);
    expect((await service.getState()).openFolders.map(folder => folder.root)).toEqual(roots);
    await service.openRecentFolder(roots[0]);
    expect((await service.getState()).workspace?.root).toBe(roots[0]);
    expect((await service.getState()).openFolders.map(folder => folder.root)).toEqual(roots);
    await expect(service.openRecentFolder(directory)).rejects.toThrow("native folder picker");
  } finally {
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
