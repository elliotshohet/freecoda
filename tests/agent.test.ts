import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAgent, directModel } from "../packages/core/src";
test("real compatible transport runs read -> edit -> verify loop without external services", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-agent-"));
  await writeFile(
    path.join(root, "sum.ts"),
    "export const sum = (a, b) => a - b;",
  );
  let turns = 0;
  let outbound = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      outbound++;
      expect(new URL(req.url).pathname).toBe("/v1/chat/completions");
      const body = (await req.json()) as {
        messages: { role: string; content: unknown }[];
      };
      const tool =
        turns === 0
          ? { name: "read_file", args: { path: "sum.ts" } }
          : turns === 1
            ? {
                name: "replace_text",
                args: { path: "sum.ts", search: "a - b", replacement: "a + b" },
              }
            : null;
      const id = `call-${turns++}`;
      const chunks = tool
        ? [
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    tool_calls: [
                      {
                        index: 0,
                        id,
                        type: "function",
                        function: {
                          name: tool.name,
                          arguments: JSON.stringify(tool.args),
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
            { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
          ]
        : [
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    content:
                      "Fixed addition in sum.ts. No test runner is configured.",
                  },
                  finish_reason: null,
                },
              ],
            },
            { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
          ];
      const stream =
        chunks
          .map(
            (c) =>
              "data: " +
              JSON.stringify({
                id: "test-completion",
                model: "fixture-model",
                object: "chat.completion.chunk",
                ...c,
              }) +
              "\n\n",
          )
          .join("") + "data: [DONE]\n\n";
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });
  try {
    let approvals = 0;
    const result = await runAgent({
      root,
      model: directModel(
        `http://127.0.0.1:${server.port}/v1`,
        "fixture-model",
        "",
      ),
      messages: [{ role: "user", content: "Fix addition." }],
      approve: async () => {
        approvals++;
        return true;
      },
    });
    expect(await readFile(path.join(root, "sum.ts"), "utf8")).toContain(
      "a + b",
    );
    expect(approvals).toBe(1);
    expect(outbound).toBe(3);
    expect(result.text).toContain("Fixed addition");
    expect(result.messages.length).toBeGreaterThan(3);
  } finally {
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
test("plan mode exposes only read tools to the provider", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-plan-"));
  let names: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const body = (await req.json()) as {
        tools: { function: { name: string } }[];
      };
      names = body.tools.map((t) => t.function.name);
      return new Response(
        "data: " +
          JSON.stringify({
            id: "plan",
            model: "fixture",
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "Read-only plan." },
                finish_reason: "stop",
              },
            ],
          }) +
          "\n\ndata: [DONE]\n\n",
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  try {
    await runAgent({
      root,
      mode: "plan",
      model: directModel(`http://127.0.0.1:${server.port}/v1`, "fixture", ""),
      messages: [{ role: "user", content: "Make a plan." }],
      approve: async () => {
        throw new Error("Should not request approval");
      },
    });
    expect(names.sort()).toEqual(["list_files", "read_file", "search"]);
  } finally {
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 10000);
