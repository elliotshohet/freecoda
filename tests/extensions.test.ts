import { test, expect } from "bun:test";
import {
  mkdtemp,
  writeFile,
  mkdir,
  rm,
  readFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  emptyExtensionRegistry,
  installSkill,
  installSkillFromText,
  installMcpServer,
  setExtensionEnabled,
  removeExtension,
  publicExtensions,
  loadExtensionRegistry,
  saveExtensionRegistry,
  connectExtensionTools,
  extensionFetch,
  validateExtensionUrl,
  runAgent,
  directModel,
} from "../packages/core/src";

test("skills install supporting files, persist privately, disable and remove", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "freecoda-extensions-"));
  try {
    await writeFile(
      path.join(dir, "SKILL.md"),
      "---\nname: fixture-skill\n---\nUse the fixture style guide.",
    );
    await mkdir(path.join(dir, "references"));
    await writeFile(
      path.join(dir, "references", "guide.md"),
      "Prefer short sentences.",
    );
    let registry = await installSkill(emptyExtensionRegistry(), {
      source: path.join(dir, "SKILL.md"),
      allowLocal: true,
    });
    expect(registry.skills[0].files?.["references/guide.md"]).toBe(
      "Prefer short sentences.",
    );
    const file = path.join(dir, "state", "extensions.json");
    await saveExtensionRegistry(file, registry);
    registry = await loadExtensionRegistry(file);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const connected = await connectExtensionTools(registry, {
      approve: async () => false,
      readOnly: true,
    });
    expect(connected.instructions).toContain("fixture style guide");
    expect(connected.instructions).toContain("references/guide.md");
    expect(
      await (
        connected.tools.skill_file!.execute as (
          input: any,
          context: any,
        ) => Promise<unknown>
      )(
        { skillId: registry.skills[0].id, path: "references/guide.md" },
        { toolCallId: "file", messages: [] },
      ),
    ).toEqual({ content: "Prefer short sentences." });
    await connected.close();
    registry = setExtensionEnabled(registry, registry.skills[0].id, false);
    expect(
      (await connectExtensionTools(registry, { approve: async () => false }))
        .instructions,
    ).toBe("");
    registry = removeExtension(registry, registry.skills[0].id);
    expect(registry.skills).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("real MCP HTTP install/discovery/use respects denial and strips image semantics and private headers", async () => {
  let calls = 0,
    closed = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      if (req.method === "DELETE") {
        closed++;
        return new Response(null, { status: 204 });
      }
      if (req.method === "GET") return new Response(null, { status: 405 });
      const message = (await req.json()) as any;
      const headers = {
        "Content-Type": "application/json",
        "Mcp-Session-Id": "fixture-session",
      };
      if (
        message.method === "notifications/initialized" ||
        message.id === undefined
      )
        return new Response(null, { status: 202 });
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            }
          : message.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "echo",
                    description: "Echo the input",
                    inputSchema: {
                      type: "object",
                      properties: { text: { type: "string" } },
                      required: ["text"],
                    },
                  },
                ],
              }
            : message.method === "tools/call"
              ? (calls++,
                {
                  content: [
                    { type: "text", text: message.params.arguments.text },
                    {
                      type: "image",
                      data: "Zml4dHVyZQ==",
                      mimeType: "image/png",
                    },
                  ],
                })
              : undefined;
      if (!result)
        return Response.json(
          {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Unsupported method" },
          },
          { headers },
        );
      return Response.json(
        { jsonrpc: "2.0", id: message.id, result },
        { headers },
      );
    },
  });
  try {
    const registry = installMcpServer(emptyExtensionRegistry(), {
      name: "Fixture",
      url: `http://127.0.0.1:${server.port}/mcp`,
      headers: { Authorization: "Bearer fixture-secret" },
    });
    expect(JSON.stringify(publicExtensions(registry))).not.toContain(
      "fixture-secret",
    );
    const denied = await connectExtensionTools(registry, {
      approve: async () => false,
      allowLocal: true,
    });
    const name = Object.keys(denied.tools)[0]!;
    expect(
      await (
        denied.tools[name]!.execute as (
          input: any,
          context: any,
        ) => Promise<unknown>
      )({ text: "must not run" }, { toolCallId: "denied", messages: [] }),
    ).toMatchObject({ denied: true });
    expect(calls).toBe(0);
    await denied.close();
    const allowed = await connectExtensionTools(registry, {
      approve: async (kind, description) => {
        expect(kind).toBe("shell");
        expect(description).toContain("External tool");
        return true;
      },
      allowLocal: true,
    });
    const result = (await (
      allowed.tools[name]!.execute as (
        input: any,
        context: any,
      ) => Promise<unknown>
    )(
      { text: "real MCP round trip" },
      { toolCallId: "allowed", messages: [] },
    )) as any;
    expect(result.content).toContain("real MCP round trip");
    expect(typeof result.content).toBe("string");
    expect(result.type).toBeUndefined();
    expect(allowed.tools[name]!.toModelOutput).toBeUndefined();
    expect(calls).toBe(1);
    await allowed.close();
    expect(closed).toBe(2);
    const before = calls;
    expect(
      Object.keys(
        (
          await connectExtensionTools(registry, {
            approve: async () => true,
            allowLocal: true,
            readOnly: true,
          })
        ).tools,
      ),
    ).toHaveLength(0);
    expect(calls).toBe(before);
    await expect(
      extensionFetch(false)(`http://127.0.0.1:${server.port}/mcp`),
    ).rejects.toThrow();
  } finally {
    await server.stop(true);
  }
});

test("Chat never loads installed skills or connects external MCP servers", async () => {
  const registry = installSkillFromText(
    installMcpServer(emptyExtensionRegistry(), {
      name: "Unreachable",
      url: "https://127.0.0.1:9/mcp",
    }),
    { name: "secret-skill", instructions: "SKILL_CONTENT_MUST_NOT_REACH_CHAT" },
  );
  let inspected = false;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const body = (await req.json()) as any;
      expect(body.tools || []).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain(
        "SKILL_CONTENT_MUST_NOT_REACH_CHAT",
      );
      inspected = true;
      return new Response(
        "data: " +
          JSON.stringify({
            id: "chat",
            model: "fixture",
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "Hello." },
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
    const result = await runAgent({
      root: "/nonexistent-chat-workspace",
      mode: "chat",
      model: directModel(`http://127.0.0.1:${server.port}/v1`, "fixture", ""),
      messages: [{ role: "user", content: "Hello" }],
      approve: async () => {
        throw Error("Unexpected approval");
      },
      extensions: registry,
    });
    expect(result.text).toBe("Hello.");
    expect(inspected).toBe(true);
  } finally {
    await server.stop(true);
  }
});

test("coding agent receives enabled installed skill guidance and omits disabled guidance", async () => {
  let registry = installSkillFromText(emptyExtensionRegistry(), {
    name: "enabled",
    instructions: "ENABLED_SKILL_GUIDANCE",
  });
  registry = installSkillFromText(registry, {
    name: "disabled",
    instructions: "DISABLED_SKILL_GUIDANCE",
  });
  registry = setExtensionEnabled(registry, registry.skills[1].id, false);
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-skill-agent-"));
  let captured = false;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const body = await req.json();
      const prompt = JSON.stringify(body);
      expect(prompt).toContain("ENABLED_SKILL_GUIDANCE");
      expect(prompt).not.toContain("DISABLED_SKILL_GUIDANCE");
      captured = true;
      return new Response(
        "data: " +
          JSON.stringify({
            id: "coding",
            model: "fixture",
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  content: "Applied skill guidance.",
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
    await runAgent({
      root: directory,
      mode: "plan",
      model: directModel(`http://127.0.0.1:${server.port}/v1`, "fixture", ""),
      messages: [{ role: "user", content: "Explain project" }],
      approve: async () => false,
      extensions: registry,
    });
    expect(captured).toBe(true);
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("hosted extension URL validation blocks local, private and credential-bearing targets", () => {
  for (const url of [
    "https://localhost/mcp",
    "https://127.0.0.1/mcp",
    "https://2130706433/mcp",
    "https://10.0.0.1/mcp",
    "https://169.254.169.254/mcp",
    "https://[::1]/mcp",
    "https://user:password@example.com/mcp",
    "https://example.com/mcp?token=secret",
  ])
    expect(() => validateExtensionUrl(url, false)).toThrow();
  expect(
    validateExtensionUrl("https://mcp.deepwiki.com/mcp", false).hostname,
  ).toBe("mcp.deepwiki.com");
});
