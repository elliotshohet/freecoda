import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
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

test("denied writes cannot repeatedly prompt or bypass through another write tool", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-denial-"));
  const original = "export const answer = 1;";
  await writeFile(path.join(root, "answer.ts"), original);
  const calls = [
    { name: "read_file", args: { path: "answer.ts" } },
    {
      name: "replace_text",
      args: { path: "answer.ts", search: "= 1", replacement: "= 2" },
    },
    {
      name: "replace_text",
      args: { path: "answer.ts", search: "= 1", replacement: "= 3" },
    },
    {
      name: "write_file",
      args: { path: "alternate.ts", content: "export const answer = 4;" },
    },
  ];
  let turn = 0,
    approvals = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch() {
      const call = calls[turn++];
      const delta = call
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `denied-${turn}`,
                type: "function",
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args),
                },
              },
            ],
          }
        : { role: "assistant", content: "The changes were declined." };
      return new Response(
        "data: " +
          JSON.stringify({
            id: "denial-fixture",
            model: "fixture",
            object: "chat.completion.chunk",
            choices: [
              { index: 0, delta, finish_reason: call ? "tool_calls" : "stop" },
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
      model: directModel(`http://127.0.0.1:${server.port}/v1`, "fixture", ""),
      messages: [{ role: "user", content: "Change the answer." }],
      approve: async (kind) => {
        expect(kind).toBe("write");
        approvals++;
        return false;
      },
    });
    expect(approvals).toBe(1);
    expect(turn).toBe(5);
    expect(await readFile(path.join(root, "answer.ts"), "utf8")).toBe(original);
    await expect(stat(path.join(root, "alternate.ts"))).rejects.toThrow();
  } finally {
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 10000);

test("chat mode needs no workspace and sends conversation without repository tools or instructions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-chat-mode-"));
  const marker = "REPOSITORY_CONTEXT_MUST_NOT_LEAVE";
  await writeFile(path.join(root, "AGENTS.md"), marker);
  let requests: any[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      requests.push(await req.json());
      return new Response(
        "data: " +
          JSON.stringify({
            id: "chat-mode-fixture",
            model: "fixture",
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  content: "A helpful conversation.",
                },
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
    for (const directory of [root, path.join(root, "does-not-exist")]) {
      const result = await runAgent({
        root: directory,
        mode: "chat",
        model: directModel(`http://127.0.0.1:${server.port}/v1`, "fixture", ""),
        messages: [{ role: "user", content: "Help me plan a weekend." }],
        approve: async () => {
          throw Error("Chat cannot request tool approval");
        },
      });
      expect(result.text).toBe("A helpful conversation.");
    }
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.tools || []).toHaveLength(0);
      expect(JSON.stringify(request.messages)).not.toContain(marker);
      expect(request.messages[0].content).toContain("conversational assistant");
      expect(request.messages.at(-1).content).toBe("Help me plan a weekend.");
    }
  } finally {
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
