import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalAgentService } from "../apps/desktop/src/local-agent";
import type { DesktopEvent } from "../apps/desktop/src/shared";
async function fixture(signedIn = false, failOpen = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-voice-"));
  if (signedIn) await writeFile(path.join(directory, "desktop.json"), JSON.stringify({ server: "https://freecoda.com", token: "a".repeat(40), accountId: "alice", trustedRoots: [], recentRoots: [] }));
  const events: DesktopEvent[] = []; let opened = "", modelAborted = false;
  const service = new LocalAgentService({ dataDirectory: directory, emit(event) { events.push(event); }, async openExternal() { throw Error("Generic opener must not receive a voice URL"); }, async openVoiceCompanion(url) { opened = url; if (failOpen) throw Error("Browser could not open"); },
    async fetch(input, init) {
      if (String(input).endsWith("/models")) return new Promise<Response>((_, reject) => { const cancel = () => { modelAborted = true; reject(Error("Cancelled")); }; if (init?.signal?.aborted) cancel(); else init?.signal?.addEventListener("abort", cancel, { once: true }); });
      throw Error("Offline fixture");
    },
  });
  const post = async (endpoint: string, body: unknown) => {
    const url = new URL(opened); const token = url.hash.slice(1); return fetch(new URL(endpoint, url), { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  };
  return { service, events, post, get opened() { return opened; }, get modelAborted() { return modelAborted; }, async cleanup() { await service.dispose(); await rm(directory, { recursive: true, force: true }); } };
}

test("desktop dictation stays an editable scoped event, never starts an agent, and closes on navigation", async () => {
  const f = await fixture();
  try {
    await expect(f.service.startVoice({ mode: "invalid" as any, agentMode: "chat" })).rejects.toThrow("valid voice mode");
    await f.service.startVoice({ mode: "dictation", agentMode: "chat" });
    expect((await f.service.getState()).voiceActive).toBe(true);
    const scope = (await f.service.getState()).composerDraftKey!;
    expect((await f.post("/transcript", { mode: "dictation", text: "Editable words" })).status).toBe(200);
    expect(f.events).toContainEqual({ type: "voice-dictation", text: "Editable words", scope });
    expect(f.events.some(event => event.type === "run-started")).toBe(false);
    const oldURL = f.opened;
    await f.service.createThread();
    expect((await f.service.getState()).voiceActive).toBe(false);
    await expect(fetch(oldURL)).rejects.toThrow();
    expect(f.events.filter(event => event.type === "voice-dictation")).toHaveLength(1);
  } finally { await f.cleanup(); }
});

test("desktop voice controls cancel only their owned normal agent turn, never an unrelated request", async () => {
  const f = await fixture(true);
  try {
    await f.service.createThread();
    await f.service.startVoice({ mode: "conversation", agentMode: "chat" });
    await f.service.runAgent({ prompt: "A typed request", mode: "chat" });
    expect((await f.post("/control", { action: "interrupt" })).status).toBe(200);
    expect(f.modelAborted).toBe(false);
    await f.service.stopVoice();
    expect((await f.service.getState()).running).toBe(true);
    await f.service.cancelRun();
    expect(f.modelAborted).toBe(true);
    await f.service.startVoice({ mode: "conversation", agentMode: "chat" });
    expect((await f.post("/transcript", { mode: "conversation", text: "/exit", turnId: "11111111-1111-4111-8111-111111111111" })).status).toBe(200);
    expect(f.events.some(event => event.type === "voice-turn" && event.text === "/exit")).toBe(true);
    expect((await f.service.getState()).running).toBe(true);
    expect((await f.post("/control", { action: "interrupt" })).status).toBe(200);
    expect((await f.service.getState()).running).toBe(false);
  } finally { await f.cleanup(); }
});

test("voice honors sign-in, active mode and folder trust, and cleans up when the dedicated browser opener fails", async () => {
  const anonymous = await fixture();
  try { await expect(anonymous.service.startVoice({ mode: "conversation", agentMode: "chat" })).rejects.toThrow("Sign in"); }
  finally { await anonymous.cleanup(); }
  const f = await fixture(true, true);
  try {
    await expect(f.service.startVoice({ mode: "dictation", agentMode: "chat" })).rejects.toThrow("Browser could not open");
    expect((await f.service.getState()).voiceActive).toBe(false);
    await expect(fetch(f.opened)).rejects.toThrow();
    await expect(f.service.startVoice({ mode: "conversation", agentMode: "build" })).rejects.toThrow("active conversation mode");
    const workspace = path.join(tmpdir(), `voice-untrusted-${Date.now()}`); await mkdir(workspace);
    try {
      await f.service.selectWorkspace(workspace);
      await expect(f.service.startVoice({ mode: "conversation", agentMode: "build" })).rejects.toThrow("Trust");
    } finally { await rm(workspace, { recursive: true, force: true }); }
  } finally { await f.cleanup(); }
});

test("first run establishes draft scope before the model and own conflict-copy migration is explicit", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let conflicted = false, base = "";
  const events: DesktopEvent[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/models")) return Response.json({ hostedEnabled: true, models: [{ id: "reflection/beam-free", provider: "reflection", approved: true, byok: false, inputMicrosPerToken: 0, outputMicrosPerToken: 0 }] });
    if (url.pathname.endsWith("/inference")) {
      await gate;
      const parts = [{ type: "text-start", id: "answer" }, { type: "text-delta", id: "answer", delta: "A completed answer" }, { type: "text-end", id: "answer" }, { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } } }];
      return new Response(parts.map(part => JSON.stringify(part) + "\n").join(""), { headers: { "Content-Type": "application/x-ndjson" } });
    }
    if (request.method === "GET" && url.pathname.endsWith("/conversations")) return Response.json({ userId: "alice", conversations: [] });
    if (request.method === "PUT") {
      if (!conflicted) { conflicted = true; return Response.json({ error: "Conflict" }, { status: 409 }); }
      return Response.json({ conversation: { version: 1 } });
    }
    return Response.json({ error: "Unknown endpoint" }, { status: 404 });
  } });
  base = `http://127.0.0.1:${server.port}`;
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-voice-migration-"));
  await writeFile(path.join(directory, "desktop.json"), JSON.stringify({ server: base, token: "a".repeat(40), accountId: "alice", trustedRoots: [], recentRoots: [] }));
  const service = new LocalAgentService({ dataDirectory: directory, serverUrl: base, emit(event) { events.push(event); }, async openExternal() {} });
  try {
    const empty = await service.loadComposerDraft();
    await service.runAgent({ prompt: "First message", mode: "chat" });
    const during = await service.loadComposerDraft();
    expect(during.key).not.toBe(empty.key);
    expect(events).toContainEqual({ type: "composer-scope-migrated", from: empty.key, to: during.key });
    expect(events.findIndex(event => event.type === "composer-scope-migrated")).toBeLessThan(events.findIndex(event => event.type === "run-started"));
    await service.saveComposerDraft({ ...during, text: "Next draft typed during response", revision: 1 });
    release();
    for (let i = 0; !events.some(event => event.type === "done") && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(events.some(event => event.type === "done")).toBe(true);
    const after = await service.loadComposerDraft();
    expect(after.key).not.toBe(during.key);
    expect(events).toContainEqual({ type: "composer-scope-migrated", from: during.key, to: after.key });
  } finally { release(); await service.dispose(); server.stop(true); await rm(directory, { recursive: true, force: true }); }
});

test("Stop during a pending cloud transcript load prevents a voice run from starting afterward", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-voice-stop-race-"));
  await writeFile(path.join(directory, "desktop.json"), JSON.stringify({ server: "https://freecoda.com", token: "a".repeat(40), accountId: "alice", trustedRoots: [], recentRoots: [] }));
  let opened = "", loading = false, release!: () => void, modelCalls = 0, loadSignal: AbortSignal | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const events: DesktopEvent[] = [];
  const service = new LocalAgentService({ dataDirectory: directory, emit(event) { events.push(event); }, async openExternal() {}, async openVoiceCompanion(url) { opened = url; }, async fetch(input, init) {
    const url = new URL(String(input));
    if (/\/conversations\/[a-f0-9-]{36}$/.test(url.pathname)) {
      loading = true; loadSignal = init?.signal || undefined;
      // Deliberately ignore abort while waiting: the service must recheck after
      // transport resolution, not rely only on fetch honoring its signal.
      await gate;
      return Response.json({ conversation: { messages: [{ role: "user", content: "Cloud history that must not be loaded after Stop" }], version: 1 } });
    }
    if (url.pathname.endsWith("/models") || url.pathname.endsWith("/inference")) modelCalls++;
    throw Error("Offline fixture");
  } });
  const post = (endpoint: string, body: unknown) => { const url = new URL(opened); return fetch(new URL(endpoint, url), { method: "POST", headers: { Authorization: `Bearer ${url.hash.slice(1)}`, Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }); };
  try {
    await service.createThread();
    (service as any).threads[0].cloudLoaded = false;
    await service.startVoice({ mode: "conversation", agentMode: "chat" });
    const turnId = "22222222-2222-4222-8222-222222222222";
    const transcript = post("/transcript", { text: "A voice request", mode: "conversation", turnId });
    for (let i = 0; !loading && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(loading).toBe(true);
    expect((await post("/control", { action: "stop", turnId })).status).toBe(200);
    expect(loadSignal?.aborted).toBe(true);
    release();
    expect((await transcript).status).toBe(400);
    expect(modelCalls).toBe(0);
    expect(events.some(event => event.type === "run-started")).toBe(false);
    expect((await service.getState()).conversation).toEqual([]);
  } finally { release(); await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("a typed request cannot mutate history or start in a scope changed during cloud history loading", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-typed-scope-race-"));
  await writeFile(path.join(directory, "desktop.json"), JSON.stringify({ server: "https://freecoda.com", token: "a".repeat(40), accountId: "alice", trustedRoots: [], recentRoots: [] }));
  let loading = false, release!: () => void, modelCalls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const events: DesktopEvent[] = [];
  const service = new LocalAgentService({ dataDirectory: directory, emit(event) { events.push(event); }, async openExternal() {}, async fetch(input) {
    const url = new URL(String(input));
    if (/\/conversations\/[a-f0-9-]{36}$/.test(url.pathname)) {
      loading = true; await gate;
      return Response.json({ conversation: { messages: [{ role: "user", content: "Old account conversation must not enter the new scope" }], version: 1 } });
    }
    if (url.pathname.endsWith("/models") || url.pathname.endsWith("/inference")) modelCalls++;
    throw Error("Offline fixture");
  } });
  try {
    await service.createThread();
    const oldThread = (service as any).threads[0]; oldThread.cloudLoaded = false;
    const pending = service.runAgent({ prompt: "A typed request for the previous conversation", mode: "chat" });
    const rejected = pending.then(() => ({ error: undefined }), error => ({ error }));
    for (let i = 0; !loading && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(loading).toBe(true);
    await service.createThread();
    const newScope = (await service.getState()).composerDraftKey;
    release(); const outcome = await rejected;
    expect(outcome.error?.message).toContain("conversation changed");
    expect((await service.getState()).composerDraftKey).toBe(newScope);
    expect((await service.getState()).conversation).toEqual([]);
    expect(oldThread.messages).toEqual([]);
    expect(modelCalls).toBe(0);
    expect(events.some(event => event.type === "run-started")).toBe(false);
  } finally { release(); await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});
