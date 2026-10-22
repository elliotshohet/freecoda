import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAgent, directModel } from "../packages/core/src";
import { specialistDelegation } from "../packages/core/src/specialist-delegation";
import { tool } from "ai";
import { z } from "zod";

function completion(call?: { name: string; args: unknown }, text = "Evidence in app.ts; no validation run.") {
  return new Response("data: " + JSON.stringify({
    id: "specialist-fixture", model: "fixture", object: "chat.completion.chunk",
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    choices: [{ index: 0, delta: call ? {
      role: "assistant", tool_calls: [{ index: 0, id: crypto.randomUUID(), type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }],
    } : { role: "assistant", content: text }, finish_reason: call ? "tool_calls" : "stop" }],
  }) + "\n\ndata: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
}

async function fixture(handler: (body: any) => Response | Promise<Response>, run: (root: string, model: ReturnType<typeof directModel>) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-specialist-"));
  await writeFile(path.join(root, "app.ts"), "export const answer = 1;");
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => handler(await req.json()) });
  try {
    await run(root, directModel(`http://127.0.0.1:${server.port}/v1`, "fixture", ""));
    expect(await readFile(path.join(root, "app.ts"), "utf8")).toBe("export const answer = 1;");
  } finally {
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}

const isChild = (body: any) => body.messages[0].content.includes("read-only Freecoda repository specialist");

test("one bounded specialist batch uses the parent's final native read intersection", async () => {
  let parentTurns = 0;
  const childTurns: Record<string, number> = {};
  const results: any[] = [];
  await fixture((body) => {
    if (isChild(body)) {
      expect(body.messages[0].content).toContain("LOCAL_GUIDANCE_SANITIZED");
      expect(body.messages[0].content).not.toContain("LOCAL_GUIDANCE_PRIVATE");
      expect(body.messages[0].content).toContain("subordinate to all read-only, no-execution");
      expect(body.tools.map((t: any) => t.function.name).sort()).toEqual(["list_files", "read_file", "repository_map"]);
      const task = body.messages[1].content;
      childTurns[task] = (childTurns[task] ?? 0) + 1;
      // Always request another read: the SDK must stop at five steps.
      return completion({ name: "read_file", args: { path: "app.ts" } });
    }
    parentTurns++;
    if (parentTurns <= 2) return completion({ name: "delegate_specialists", args: { tasks: [{ task: "inspect-a" }, { task: "inspect-b" }] } });
    return completion(undefined, "Integrated limited evidence; no validation run.");
  }, async (root, model) => {
    await writeFile(path.join(root, "AGENTS.md"), "LOCAL_GUIDANCE_PRIVATE");
    const result = await runAgent({ root, model, mode: "plan", disabledTools: ["search"],
      redactText: (text) => text.replaceAll("LOCAL_GUIDANCE_PRIVATE", "LOCAL_GUIDANCE_SANITIZED"),
      messages: [{ role: "user", content: "Research two areas." }], approve: async () => { throw new Error("No approval allowed"); },
      onToolResult: (name, output) => { if (name === "delegate_specialists") results.push(output); },
    });
    expect(childTurns).toEqual({ "inspect-a": 5, "inspect-b": 5 });
    expect(result.usage.totalTokens).toBe(65);
    expect(results[0].status).toBe("limited");
    expect(results[0].findings.map((x: any) => x.status)).toEqual(["limited", "limited"]);
    expect(results[1].status).toBe("unavailable");
  });
});

test("specialist deadline returns a sanitized error even when a native read ignores abort", async () => {
  let requests = 0, reads = 0;
  await fixture(() => {
    requests++;
    return completion({ name: "read_file", args: { path: "app.ts" } });
  }, async (_root, model) => {
    const delegate = specialistDelegation({
      model, timeoutMs: 250, redact: (text) => text,
      nativeTools: { read_file: tool({
        inputSchema: z.object({ path: z.string() }),
        execute: async (_input, context) => {
          expect(context.abortSignal).toBeDefined();
          reads++;
          await new Promise<void>(() => {});
          return { content: "unreachable" };
        },
      }) },
    });
    const output: any = await delegate.execute!({ tasks: [{ task: "Inspect" }] }, { toolCallId: "deadline", messages: [], context: {} });
    expect(output.status).toBe("error");
    expect(output.findings[0].error).toBe("Specialist research timed out. No validation was performed.");
    expect(requests).toBe(1);
    expect(reads).toBe(1);
  });
});

test("specialists cannot write or recurse and return capped redacted findings", async () => {
  let parentTurns = 0, childTurns = 0;
  let output: any;
  await fixture((body) => {
    if (isChild(body)) {
      const names = body.tools.map((t: any) => t.function.name);
      expect(names.sort()).toEqual(["list_files", "read_file", "repository_map", "search"]);
      if (++childTurns === 1) return completion({ name: "write_file", args: { path: "app.ts", content: "changed" } });
      return completion(undefined, "Evidence. ".repeat(1200));
    }
    return ++parentTurns === 1
      ? completion({ name: "delegate_specialists", args: { tasks: [{ task: "Inspect code" }] } })
      : completion();
  }, async (root, model) => {
    await runAgent({ root, model, messages: [{ role: "user", content: "Inspect." }],
      approve: async () => { throw new Error("No writes allowed"); },
      redactText: (text) => text.replaceAll("Evidence", "Sanitized"),
      onToolResult: (name, result) => { if (name === "delegate_specialists") output = result; },
    });
    expect(childTurns).toBe(2);
    expect(output.findings[0].findings.length).toBeLessThanOrEqual(6000);
    expect(output.findings[0].truncated).toBe(true);
    expect(output.findings[0].findings).not.toContain("Evidence");
  });
});

test("aborting a specialist aborts the parent and performs no further reads or requests", async () => {
  const controller = new AbortController();
  let childRequests = 0, parentRequests = 0;
  await fixture((body) => {
    if (isChild(body)) {
      childRequests++;
      controller.abort();
      return completion({ name: "read_file", args: { path: "app.ts" } });
    }
    parentRequests++;
    return completion({ name: "delegate_specialists", args: { tasks: [{ task: "Inspect code" }] } });
  }, async (root, model) => {
    await expect(runAgent({ root, model, signal: controller.signal,
      messages: [{ role: "user", content: "Inspect." }], approve: async () => false,
    })).rejects.toThrow();
    expect(childRequests).toBe(1);
    expect(parentRequests).toBe(1);
  });
});

test("chat and explicit disabling never expose specialist delegation", async () => {
  await fixture((body) => {
    expect((body.tools ?? []).map((t: any) => t.function.name)).not.toContain("delegate_specialists");
    return completion();
  }, async (root, model) => {
    for (const mode of ["chat", "plan"] as const) {
      await runAgent({ root, model, mode, disabledTools: ["delegate_specialists"],
        messages: [{ role: "user", content: "Hello" }], approve: async () => false,
      });
    }
  });
});

test("specialist provider failures report a generic error without request diagnostics", async () => {
  let turns = 0;
  let output: any;
  await fixture((body) => {
    if (isChild(body)) return new Response(JSON.stringify({ error: { message: "PRIVATE_PROVIDER_DIAGNOSTIC sk-private-example", type: "server_error" } }), { status: 500, headers: { "Content-Type": "application/json" } });
    return ++turns === 1 ? completion({ name: "delegate_specialists", args: { tasks: [{ task: "Inspect" }] } }) : completion();
  }, async (root, model) => {
    await runAgent({ root, model, messages: [{ role: "user", content: "Inspect" }], approve: async () => false,
      onToolResult: (name, result) => { if (name === "delegate_specialists") output = result; },
    });
    expect(output.status).toBe("error");
    expect(output.findings[0].status).toBe("error");
    expect(JSON.stringify(output)).not.toContain("PRIVATE_PROVIDER_DIAGNOSTIC");
    expect(JSON.stringify(output)).not.toContain("sk-private-example");
  });
});
