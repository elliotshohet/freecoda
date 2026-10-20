import { test, expect } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComposerDraftStore, composerDraftKey } from "../apps/desktop/src/composer-drafts";
import { LocalAgentService } from "../apps/desktop/src/local-agent";
import { createDraftAutosave, type SavedDraft } from "../apps/desktop/src/renderer/draft-autosave";
const scope = { server: "https://freecoda.com", account: "account:alice", workspace: "freecoda:general-chat", thread: "thread-a" };

test("an owned first-turn identity migration preserves next-turn typing while an account switch clears it", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ textContent: "", setAttribute() {} }) } });
  const events = new EventTarget();
  const prompt = Object.assign(events, { value: "", closest: () => ({ append() {} }) }) as unknown as HTMLTextAreaElement;
  const abort = new AbortController(), writes: SavedDraft[] = [];
  let loadedKey = "new-thread", finishLoad: ((draft: SavedDraft) => void) | undefined;
  const controller = createDraftAutosave(prompt, {
    signal: abort.signal,
    load: () => loadedKey === "created-thread" ? new Promise(resolve => { finishLoad = resolve; }) : Promise.resolve({ key: loadedKey, text: "", revision: 0 }),
    save: async draft => { writes.push(draft); return { saved: true }; },
  });
  try {
    controller.update(loadedKey); await controller.flush();
    prompt.value = "  next turn before response finishes  "; controller.changed();
    loadedKey = "created-thread"; controller.migrate("new-thread", loadedKey);
    controller.update(loadedKey);
    prompt.value += "\nmore typing"; controller.changed();
    finishLoad!({ key: loadedKey, text: "old disk text must not overwrite typing", revision: 4 });
    await controller.flush();
    expect(prompt.value).toBe("  next turn before response finishes  \nmore typing");
    expect(writes.at(-1)).toEqual({ key: loadedKey, text: prompt.value, revision: 5 });
    loadedKey = "another-account"; controller.update(loadedKey); await controller.flush();
    expect(prompt.value).toBe("");
    expect(writes.some(draft => draft.key === loadedKey)).toBe(false);
  } finally {
    abort.abort();
    if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document");
  }
});

test("composer drafts persist exact whitespace across restart with private files and isolated account/workspace/thread scopes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-drafts-"));
  const key = composerDraftKey(scope), text = "  Explain this\n\n    preserve indentation  ";
  try {
    await new ComposerDraftStore(directory).save({ key, text, revision: 1 });
    const restarted = new ComposerDraftStore(directory);
    expect(await restarted.load(key)).toEqual({ key, text, revision: 1 });
    expect((await stat(path.join(directory, `${key}.json`))).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    for (const isolated of [{ ...scope, account: "account:bob" }, { ...scope, workspace: "/other/repository" }, { ...scope, thread: "thread-b" }, { ...scope, account: "anonymous" }]) {
      expect((await restarted.load(composerDraftKey(isolated))).text).toBe("");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("serialized saves reject stale revisions and persist explicit empty draft clears", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-drafts-"));
  const key = composerDraftKey(scope), store = new ComposerDraftStore(directory);
  try {
    const results = await Promise.all([
      store.save({ key, text: "newest", revision: 3 }),
      store.save({ key, text: "stale", revision: 2 }),
      store.save({ key, text: "duplicate", revision: 3 }),
    ]);
    expect(results).toEqual([{ saved: true }, { saved: false }, { saved: false }]);
    expect((await new ComposerDraftStore(directory).load(key)).text).toBe("newest");
    await store.save({ key, text: "", revision: 4 });
    expect(await new ComposerDraftStore(directory).load(key)).toEqual({ key, text: "", revision: 4 });
    await expect(store.save({ key, text: "x".repeat(20001), revision: 5 })).rejects.toThrow("Invalid");
    await expect(store.load("../escape")).rejects.toThrow("scope");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("main process refuses stale composer scope writes after conversation switch and restores drafts after restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-drafts-service-"));
  const create = () => new LocalAgentService({ dataDirectory: directory, emit() {}, async openExternal() {}, async fetch() { throw Error("Draft persistence must not use the network"); } });
  let service = create();
  try {
    const draft = await service.loadComposerDraft();
    expect(await service.saveComposerDraft({ ...draft, text: "restart me", revision: 1 })).toEqual({ saved: true });
    await service.dispose(); service = create();
    expect((await service.loadComposerDraft()).text).toBe("restart me");
    await service.createThread();
    expect((await service.loadComposerDraft()).text).toBe("");
    expect(await service.saveComposerDraft({ ...draft, text: "late old value", revision: 2 })).toEqual({ saved: false });
  } finally { await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});


test("account changes and sign-out never expose another account's saved draft", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-drafts-account-"));
  const token = "d".repeat(40);
  const create = () => new LocalAgentService({ dataDirectory: directory, emit() {}, async openExternal() {}, async fetch() { throw Error("No network expected"); } });
  const config = async (accountId?: string) => writeFile(path.join(directory, "desktop.json"), JSON.stringify({ server: scope.server, ...(accountId ? { accountId, token } : {}), trustedRoots: [], recentRoots: [] }));
  let service: LocalAgentService | undefined;
  try {
    await config("alice"); service = create();
    const alice = await service.loadComposerDraft();
    await service.saveComposerDraft({ ...alice, text: "Alice private draft", revision: 1 }); await service.dispose();
    await config("bob"); service = create();
    expect((await service.loadComposerDraft()).text).toBe("");
    expect(await service.saveComposerDraft({ ...alice, text: "late Alice", revision: 2 })).toEqual({ saved: false }); await service.dispose();
    await config(); service = create();
    expect((await service.loadComposerDraft()).text).toBe(""); await service.dispose();
    await config("alice"); service = create();
    expect((await service.loadComposerDraft()).text).toBe("Alice private draft");
  } finally { await service?.dispose(); await rm(directory, { recursive: true, force: true }); }
});


test("new device account with unavailable identity cannot recover the previous account draft, including after restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-drafts-login-"));
  const server = "http://127.0.0.1:3999";
  await writeFile(path.join(directory, "desktop.json"), JSON.stringify({ server, accountId: "alice", token: "a".repeat(40), trustedRoots: [], recentRoots: [] }));
  let authenticated = false;
  const create = () => new LocalAgentService({ dataDirectory: directory, serverUrl: server,
    emit(event) { if (event.type === "auth" && event.signedIn && event.message.includes("connected")) authenticated = true; },
    async openExternal() {}, async wait() { await new Promise(resolve => setTimeout(resolve, 1)); },
    async fetch(input) {
      const url = String(input);
      if (url.endsWith("/device/start")) return Response.json({ deviceCode: "C".repeat(43), userCode: "ABCD-EFGH", verificationUri: server + "/device?code=ABCD-EFGH", expiresIn: 600, interval: 5 });
      if (url.endsWith("/device/poll")) return Response.json({ status: "approved", token: "b".repeat(40) });
      throw Error("Account identity unavailable offline");
    },
  });
  let service = create();
  try {
    const alice = await service.loadComposerDraft();
    await service.saveComposerDraft({ ...alice, text: "Alice sensitive draft", revision: 1 });
    await service.login();
    for (let attempt = 0; !authenticated && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(authenticated).toBe(true);
    const unknownAccount = await service.loadComposerDraft();
    expect(unknownAccount.key).not.toBe(alice.key);
    expect(unknownAccount.text).toBe("");
    expect(await service.saveComposerDraft({ ...alice, text: "old stale write", revision: 2 })).toEqual({ saved: false });
    await service.dispose(); service = create();
    expect((await service.loadComposerDraft()).text).toBe("");
    expect((await service.loadComposerDraft()).key).toBe(unknownAccount.key);
    const original = new ComposerDraftStore(path.join(directory, "composer-drafts"));
    expect((await original.load(alice.key)).text).toBe("Alice sensitive draft");
  } finally { await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});
