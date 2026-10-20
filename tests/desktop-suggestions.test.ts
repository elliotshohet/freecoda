import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalAgentService } from "../apps/desktop/src/local-agent";

test("AI composer suggestions are tool-free, bounded, and never create conversation history", async () => {
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const body = await request.json(); requests.push(body);
    return Response.json({ content: [{ type: "text", text: " the edge cases" }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 5 }, outputTokens: { total: 4 } }, warnings: [] });
  } });
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-suggestions-"));
  const workspace = await realpath(directory);
  await writeFile(path.join(workspace, "private.txt"), "WORKSPACE_FILE_MUST_NOT_BE_READ");
  const data = path.join(directory, "data"); await mkdir(data);
  const base = `http://127.0.0.1:${server.port}`;
  await writeFile(path.join(data, "desktop.json"), JSON.stringify({ server: base, token: "a".repeat(40), trustedRoots: [workspace], recentRoots: [workspace] }));
  const service = new LocalAgentService({ dataDirectory: data, serverUrl: base, emit() {}, async openExternal() {}, async fetch() {
    return Response.json({ hostedEnabled: true, models: [{ id: "reflection/beam-free", provider: "reflection", approved: true, byok: false, inputMicrosPerToken: 0, outputMicrosPerToken: 0 }] });
  } });
  try {
    await service.selectWorkspace(workspace);
    const before = await service.getState();
    expect(await service.suggestPrompt({ prefix: "Review" })).toEqual({ suggestion: " the edge cases" });
    expect(requests).toHaveLength(1);
    expect(requests[0].operation).toBe("generate");
    const serialized = JSON.stringify(requests[0]);
    expect(serialized).toContain(path.basename(workspace));
    expect(serialized).not.toContain("WORKSPACE_FILE_MUST_NOT_BE_READ");
    expect(serialized).not.toContain(workspace);
    expect(requests[0].options.tools ?? []).toEqual([]);
    expect(requests[0].options.maxOutputTokens).toBe(1024);
    const after = await service.getState();
    expect(after.conversation).toEqual(before.conversation);
    expect(after.threads).toEqual(before.threads);
    // A pending cooldown is cancellable before catalog or inference is sent.
    const cancelled = service.suggestPrompt({ prefix: "Another" });
    await new Promise(resolve => setTimeout(resolve, 15));
    service.cancelSuggestion();
    await expect(cancelled).rejects.toThrow("cancelled");
    expect(requests).toHaveLength(1);
    await expect(service.suggestPrompt({ prefix: "x".repeat(2001) })).rejects.toThrow("invalid");
  } finally { await service.dispose(); server.stop(true); await rm(directory, { recursive: true, force: true }); }
});

test("AI suggestions require account access and never substitute canned text", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-suggestions-"));
  let calls = 0;
  const service = new LocalAgentService({ dataDirectory: directory, emit() {}, async openExternal() {}, async fetch() { calls++; throw Error("unexpected transport"); } });
  try {
    await expect(service.suggestPrompt({ prefix: "" })).rejects.toThrow("Sign in");
    expect(calls).toBe(0);
  } finally { await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});
