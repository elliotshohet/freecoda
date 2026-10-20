import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DesktopSessionManager } from "../apps/desktop/src/desktop-session-manager";
import type { DesktopEvent } from "../apps/desktop/src/shared";

async function until(check: () => boolean) {
  for (let index = 0; index < 300; index++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error("Timed out waiting for local session fixture.");
}
async function fixture(layout: "independent" | "siblings" | "linked" = "independent") {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "freecoda-session-test-")));
  const data = path.join(directory, "private");
  const outer = path.join(directory, "project");
  const roots = layout === "siblings" ? [path.join(outer, "first"), path.join(outer, "second")]
    : layout === "linked" ? [outer, path.join(outer, "nested")]
      : [outer, path.join(directory, "other")];
  for (const root of [data, ...roots]) await mkdir(root, { recursive: true });
  for (const root of roots) await writeFile(path.join(root, "note.txt"), "Original text");
  if (layout === "siblings") await mkdir(path.join(outer, ".git"));
  if (layout === "linked") {
    const metadata = path.join(directory, "elsewhere", ".git", "worktrees", "nested");
    await mkdir(metadata, { recursive: true });
    await writeFile(path.join(metadata, "commondir"), "../..\n");
    await writeFile(path.join(roots[1]!, ".git"), `gitdir: ${metadata}\n`);
  }
  const token = "a".repeat(40);
  await writeFile(path.join(data, "desktop.json"), JSON.stringify({ server: "https://fixture.invalid", token, accountId: "alice", trustedRoots: roots, recentRoots: roots, openRoots: roots }));
  const events: { sessionId: string; event: DesktopEvent }[] = [];
  let modelCalls = 0, activeModels = 0, failRunningState = false;
  const conversations = new Map<string, { id: string; title: string; messages: unknown[]; version: number; updatedAt: string }>();
  const options = { dataDirectory: data, serverUrl: "https://fixture.invalid", emit() {}, emitSession(event: { sessionId: string; event: DesktopEvent }) { events.push(event); if (failRunningState && event.event.type === "state" && event.event.state.running) { failRunningState = false; throw Error("Fixture startup state failure"); } }, async openExternal() {}, async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input));
    if (url.origin !== "https://fixture.invalid") throw Error("Fixture blocked nonlocal transport");
    if (url.pathname.endsWith("/models")) {
      modelCalls++; activeModels++;
      return new Promise((_, reject) => {
        const abort = () => { activeModels--; reject(Error("Fixture model cancelled")); };
        if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    if (url.pathname.endsWith("/devices/logout")) return Response.json({ ok: true });
    if (url.pathname.endsWith("/conversations")) return Response.json({ userId: "alice", conversations: [...conversations.values()], nextCursor: null });
    const id = /\/conversations\/([^/]+)$/.exec(url.pathname)?.[1];
    if (id && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      const value = { id, title: body.title, messages: body.messages, version: (conversations.get(id)?.version ?? 0) + 1, updatedAt: new Date().toISOString() };
      conversations.set(id, value); return Response.json({ conversation: value });
    }
    if (id && init?.method === "DELETE") { conversations.delete(id); return Response.json({ ok: true }); }
    if (id && conversations.has(id)) return Response.json({ conversation: conversations.get(id) });
    throw Error(`Unexpected local fixture endpoint: ${url.pathname}`);
  } };
  const manager = new DesktopSessionManager(options);
  await manager.initialize();
  return { directory, data, roots, token, events, options, manager, failNextRunningState() { failRunningState = true; }, get activeModels() { return activeModels; }, get modelCalls() { return modelCalls; }, async cleanup() { await manager.dispose(); await rm(directory, { recursive: true, force: true }); } };
}

test("independent project sessions run concurrently and cancellation stays with its owner", async () => {
  const f = await fixture();
  try {
    await f.manager.activeService.selectWorkspace(f.roots[0]!);
    const first = await f.manager.activeService.runAgent({ prompt: "Inspect first", mode: "plan" });
    await until(() => f.modelCalls === 1);
    const created = await f.manager.createSession({ root: f.roots[1], mode: "coding" });
    const secondId = created.activeSessionId;
    const second = await f.manager.activeService.runAgent({ prompt: "Inspect second", mode: "plan" });
    await until(() => f.modelCalls === 2);
    expect(first.runId).not.toBe(second.runId);
    expect(f.manager.snapshot().sessions.filter(session => session.status === "running")).toHaveLength(2);
    await f.manager.cancelSession("primary");
    expect((await f.manager.activeService.getState()).running).toBe(true);
    expect(f.manager.snapshot().sessions.find(session => session.id === secondId)?.status).toBe("running");
    await f.manager.cancelSession(secondId);
    expect((await f.manager.activeService.getState()).running).toBe(false);
    expect(JSON.stringify(f.events)).not.toContain(f.token);
  } finally { await f.cleanup(); }
});

for (const layout of ["siblings", "linked"] as const) test(`${layout} repository scopes serialize complete runs and queued cancellation does not stop their owner`, async () => {
  const f = await fixture(layout);
  try {
    await f.manager.activeService.selectWorkspace(f.roots[0]!);
    await f.manager.activeService.runAgent({ prompt: "Hold lease", mode: "plan" });
    await until(() => f.modelCalls === 1);
    const child = (await f.manager.createSession({ root: f.roots[1], mode: "coding" })).activeSessionId;
    const queued = f.manager.activeService.runAgent({ prompt: "Wait for lease", mode: "plan" });
    const observed = queued.then(() => "started", () => "cancelled");
    await until(() => f.manager.snapshot().sessions.find(session => session.id === child)?.status === "queued");
    expect(f.modelCalls).toBe(1);
    await f.manager.cancelSession(child);
    expect(await observed).toBe("cancelled");
    expect(f.manager.snapshot().sessions.find(session => session.id === "primary")?.status).toBe("running");
    const next = f.manager.activeService.runAgent({ prompt: "Start after release", mode: "plan" });
    await until(() => f.manager.snapshot().sessions.find(session => session.id === child)?.status === "queued");
    await f.manager.cancelSession("primary");
    await next;
    await until(() => f.modelCalls === 2);
    expect(f.manager.snapshot().sessions.find(session => session.id === child)?.status).toBe("running");
  } finally { await f.cleanup(); }
});

test("background approval descriptors remain retrievable and cannot be answered by another session", async () => {
  const f = await fixture();
  try {
    await f.manager.activeService.selectWorkspace(f.roots[0]!);
    const original = await f.manager.activeService.readFile("note.txt");
    const saving = f.manager.activeService.saveFile({ path: "note.txt", content: "Denied", expectedHash: original.hash });
    const denied = saving.then(() => false, () => true);
    await until(() => f.manager.snapshot().sessions[0]!.pendingApprovals === 1);
    const approval = (await f.manager.listSessionApprovals("primary"))[0]!;
    await f.manager.createSession({ mode: "chat" });
    expect(await f.manager.listSessionApprovals()).toEqual([]);
    expect((await f.manager.activeService.respondApproval({ id: approval.id, approved: true, scope: "session" })).accepted).toBe(false);
    expect((await f.manager.listSessionApprovals("primary"))[0]).toEqual(approval);
    await f.manager.respondToSessionApproval({ ...approval, sessionId: "primary", approved: false, scope: "once" });
    expect(await denied).toBe(true);
    expect(await readFile(path.join(f.roots[0]!, "note.txt"), "utf8")).toBe("Original text");
    expect(await f.manager.listSessionApprovals("primary")).toEqual([]);
  } finally { await f.cleanup(); }
});

test("drafts and credentials stay session/account scoped across sign-out", async () => {
  const f = await fixture();
  try {
    const original = await f.manager.activeService.loadComposerDraft();
    await f.manager.activeService.saveComposerDraft({ ...original, text: "Primary draft", revision: 1 });
    const child = (await f.manager.createSession({ mode: "chat" })).activeSessionId;
    const draft = await f.manager.activeService.loadComposerDraft();
    expect(draft.key).not.toBe(original.key);
    await f.manager.activeService.saveComposerDraft({ ...draft, text: "Child draft", revision: 1 });
    expect(await readFile(path.join(f.data, "parallel-sessions", child, "desktop.json"), "utf8")).not.toContain(f.token);
    const before = (await f.manager.activeService.getState()).auth.accountScope;
    await f.manager.activeService.logout();
    expect(f.manager.snapshot().sessions).toHaveLength(1);
    const state = await f.manager.activeService.getState();
    expect(state.auth.signedIn).toBe(false);
    expect(state.auth.accountScope).not.toBe(before);
    expect(await f.manager.activeService.saveComposerDraft({ ...draft, text: "Wrong account", revision: 2 })).toEqual({ saved: false });
    expect((await f.manager.activeService.loadComposerDraft()).text).toBe("");
  } finally { await f.cleanup(); }
});

test("restart recovers interrupted records and explicit selection restores drafts without replay", async () => {
  const f = await fixture();
  let recovered: DesktopSessionManager | undefined;
  try {
    const id = (await f.manager.createSession({ root: f.roots[0], mode: "coding" })).activeSessionId;
    const draft = await f.manager.activeService.loadComposerDraft();
    await f.manager.activeService.saveComposerDraft({ ...draft, text: "Editable after restart", revision: 1 });
    await f.manager.activeService.runAgent({ prompt: "Never replay this", mode: "plan" });
    await until(() => f.modelCalls === 1);
    await f.manager.dispose();
    recovered = new DesktopSessionManager(f.options);
    await recovered.initialize();
    expect(recovered.snapshot().sessions.find(session => session.id === id)?.status).toBe("interrupted");
    expect(f.modelCalls).toBe(1);
    await recovered.selectSession(id);
    expect((await recovered.activeService.getState()).running).toBe(false);
    expect(recovered.snapshot().sessions.find(session => session.id === id)?.status).toBe("idle");
    expect((await recovered.activeService.loadComposerDraft()).text).toBe("Editable after restart");
    expect(f.modelCalls).toBe(1);
  } finally { await recovered?.dispose(); await f.cleanup(); }
});

test("loopback inference stream carries cumulative revision watermarks into session hydration", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "freecoda-session-stream-")));
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value) + "\n");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/models")) return Response.json({ hostedEnabled: true, models: [{ id: "reflection/beam-free", provider: "reflection", approved: true, byok: false, inputMicrosPerToken: 0, outputMicrosPerToken: 0 }] });
    if (url.pathname.endsWith("/conversations")) return Response.json({ userId: "alice", conversations: [], nextCursor: null });
    if (request.method === "PUT" && url.pathname.includes("/conversations/")) return Response.json({ conversation: { version: 1 } });
    if (url.pathname.endsWith("/inference")) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      stream = controller;
      controller.enqueue(encode({ type: "text-start", id: "fixture-answer" }));
      controller.enqueue(encode({ type: "text-delta", id: "fixture-answer", delta: "Hello" }));
    } }), { headers: { "Content-Type": "application/x-ndjson" } });
    return Response.json({ error: "Unexpected local endpoint" }, { status: 404 });
  } });
  const base = `http://127.0.0.1:${server.port}`;
  await writeFile(path.join(directory, "desktop.json"), JSON.stringify({ server: base, token: "b".repeat(40), accountId: "alice", trustedRoots: [], recentRoots: [] }));
  const events: DesktopEvent[] = [];
  const manager = new DesktopSessionManager({ dataDirectory: directory, serverUrl: base, emit(event) { events.push(event); }, async openExternal() {} });
  try {
    await manager.initialize();
    await manager.createSession({ mode: "chat" });
    const { runId } = await manager.activeService.runAgent({ prompt: "A fixture question", mode: "chat" });
    await until(() => events.some(event => event.type === "text-delta" && event.runId === runId));
    const partial = await manager.activeService.getState();
    expect(partial.activeStream).toEqual({ runId, text: "Hello", revision: 1 });
    expect(partial.conversation?.at(-1)).toEqual({ role: "assistant", text: "Hello" });
    const first = events.find(event => event.type === "text-delta" && event.runId === runId);
    expect(first && first.type === "text-delta" && first.streamText).toBe("Hello");
    expect(first && first.type === "text-delta" && first.streamRevision).toBe(1);
    stream!.enqueue(encode({ type: "text-delta", id: "fixture-answer", delta: " world" }));
    await until(() => events.some(event => event.type === "text-delta" && event.streamRevision === 2));
    expect((await manager.activeService.getState()).activeStream).toEqual({ runId, text: "Hello world", revision: 2 });
    stream!.enqueue(encode({ type: "text-end", id: "fixture-answer" }));
    stream!.enqueue(encode({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } } }));
    stream!.close(); stream = undefined;
    await until(() => events.some(event => event.type === "done" && event.runId === runId));
    expect((await manager.activeService.getState()).activeStream).toBeUndefined();
    expect((await manager.activeService.getState()).conversation?.at(-1)?.text).toBe("Hello world");
  } finally {
    await manager.dispose(); server.stop(true); await rm(directory, { recursive: true, force: true });
  }
});

test("failed startup state publication stops its owned run before another turn can acquire the lease", async () => {
  const f = await fixture();
  try {
    await f.manager.activeService.selectWorkspace(f.roots[0]!);
    f.failNextRunningState();
    await expect(f.manager.activeService.runAgent({ prompt: "Startup must fail", mode: "plan" })).rejects.toThrow("Fixture startup state failure");
    expect(f.activeModels).toBe(0);
    expect((await f.manager.activeService.getState()).running).toBe(false);
    const run = await f.manager.activeService.runAgent({ prompt: "Start safely after failure", mode: "plan" });
    await until(() => f.activeModels === 1);
    expect(f.manager.snapshot().sessions[0]?.runId).toBe(run.runId);
  } finally { await f.cleanup(); }
});

test("interactive process reservation rejects overlapping agent starts until its full lifetime ends", async () => {
  const f = await fixture("siblings");
  let release: (() => void) | undefined;
  try {
    await f.manager.activeService.selectWorkspace(f.roots[0]!);
    release = await f.manager.reserveExternalWorkspace(f.roots[0]!, "fixture-terminal");
    await f.manager.createSession({ root: f.roots[1], mode: "coding" });
    await expect(f.manager.activeService.runAgent({ prompt: "Blocked by terminal", mode: "plan" })).rejects.toThrow("interactive terminal");
    expect(f.modelCalls).toBe(0);
    release(); release = undefined;
    await f.manager.activeService.runAgent({ prompt: "Terminal has exited", mode: "plan" });
    await until(() => f.modelCalls === 1);
  } finally { release?.(); await f.cleanup(); }
});
