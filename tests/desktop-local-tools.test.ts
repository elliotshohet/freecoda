import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalAgentService } from "../apps/desktop/src/local-agent";
import type { DesktopEvent } from "../apps/desktop/src/shared";

test("desktop hosted fixture uses real local read, approved write and shell tools", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-local-tools-"));
  const repository = path.join(root, "repo");
  await mkdir(repository);
  await writeFile(path.join(repository, "notes.txt"), "original local file");
  const events: DesktopEvent[] = [];
  let calls = 0;
  let service: LocalAgentService;
  const toolSteps = [
    { toolName: "read_file", input: { path: "notes.txt" } },
    { toolName: "replace_text", input: { path: "notes.txt", search: "original local file", replacement: "approved local replacement" } },
    { toolName: "shell", input: { command: "echo LOCAL_RUNTIME_OK" } },
  ];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request): Promise<Response> {
    const endpoint = new URL(request.url).pathname;
    if (endpoint.endsWith("/device/start")) return Response.json({ deviceCode: "C".repeat(43), userCode: "TEST-2345", verificationUri: `${server.url}device?code=TEST-2345`, expiresIn: 600, interval: 1 });
    if (endpoint.endsWith("/device/poll")) return Response.json({ status: "approved", token: "D".repeat(43) });
    if (endpoint.endsWith("/models")) return Response.json({ hostedEnabled: true, models: [{ id: "reflection/beam-free", provider: "reflection", approved: true, byok: false, inputMicrosPerToken: 0, outputMicrosPerToken: 0 }] });
    if (endpoint.endsWith("/inference")) {
      const step = toolSteps[calls++];
      const parts = step ? [{ type: "tool-call", toolCallId: `step-${calls}`, toolName: step.toolName, input: JSON.stringify(step.input) }] : [{ type: "text-start", id: "done" }, { type: "text-delta", id: "done", delta: "Local tools verified." }, { type: "text-end", id: "done" }];
      return new Response([...parts, { type: "finish", finishReason: { unified: step ? "tool-calls" : "stop", raw: step ? "tool_calls" : "stop" }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } } }].map(part => JSON.stringify(part) + "\n").join(""), { headers: { "Content-Type": "application/x-ndjson" } });
    }
    return Response.json({ error: "No fixture endpoint" }, { status: 404 });
  } });
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 500; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw Error("Local tool fixture timed out");
  };
  service = new LocalAgentService({ dataDirectory: path.join(root, "state"), serverUrl: server.url.origin, openExternal: async () => {}, wait: async () => {}, emit(event) {
    events.push(event);
    if (event.type === "approval") void service.respondApproval({ id: event.id, approved: true, scope: "once" });
  } });
  try {
    const selected = await service.selectWorkspace(repository);
    await service.trustWorkspace({ root: selected.root, consent: true });
    await service.login();
    await until(() => events.some(event => event.type === "auth" && event.signedIn));
    await service.runAgent({ prompt: "Read, replace the local notes, and run the approved echo command.", mode: "build" });
    await until(() => events.some(event => event.type === "done" || event.type === "error"));
    expect(events.filter(event => event.type === "error")).toHaveLength(0);
    expect(await readFile(path.join(repository, "notes.txt"), "utf8")).toBe("approved local replacement");
    expect(events.filter(event => event.type === "approval").map(event => event.type === "approval" ? event.kind : "")).toEqual(["write", "shell"]);
    const results = events.filter(event => event.type === "tool-result");
    expect(results.map(event => event.type === "tool-result" ? event.name : "")).toEqual(["read_file", "replace_text", "shell"]);
    expect(JSON.stringify(results)).toContain("LOCAL_RUNTIME_OK");
    expect(calls).toBe(4);
  } finally { await service.dispose(); server.stop(true); await rm(root, { recursive: true, force: true }); }
}, 15000);
