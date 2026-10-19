import { test, expect } from "bun:test";
import { SessionTools } from "../packages/cli/src/session-tools";
import { emptyExtensionRegistry, installMcpServer } from "../packages/core/src";

test("CLI tool selection rejects unknown tools and only removes named available tools", () => {
  const tools = new SessionTools();
  const registry = emptyExtensionRegistry();
  tools.select("shell", false, registry);
  expect([...tools.disabled]).toEqual(["shell"]);
  expect(() => tools.select("unapproved_remote", true, registry)).toThrow("Unknown tool");
  tools.select("shell", true, registry);
  expect(tools.disabled.size).toBe(0);
  expect(tools.names(registry)).not.toContain("skill_file");
});

test("CLI MCP toggles only known connections without connecting or executing", async () => {
  const tools = new SessionTools();
  const registry = installMcpServer(emptyExtensionRegistry(), { name: "fixture", url: "http://127.0.0.1:1/mcp" });
  const id = registry.servers[0]!.id;
  const disabled = await tools.mcp(`disable ${id}`, registry);
  expect(disabled.registry.servers[0]!.enabled).toBe(false);
  expect(registry.servers[0]!.enabled).toBe(true);
  await expect(tools.mcp(`discover ${id}`, disabled.registry)).rejects.toThrow("Enable");
  await expect(tools.mcp("enable missing", registry)).rejects.toThrow("Unknown MCP");
  await expect(tools.mcp(`enable ${id} extra`, registry)).rejects.toThrow("Use /mcp");
  expect((await tools.mcp("", registry)).message).toContain(id);
  expect((await tools.mcp(`enable ${id}`, disabled.registry)).registry.servers[0]!.enabled).toBe(true);
});

test("CLI MCP discovery lists actual advertised tools and closes without execution", async () => {
  const methods: string[] = [];
  let closed = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    if (req.method === "DELETE") { closed = true; return new Response(null, { status: 204 }); }
    if (req.method === "GET") return new Response(null, { status: 405 });
    const message = await req.json() as { method: string; id?: number };
    methods.push(message.method);
    if (message.id === undefined) return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize"
      ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
      : { tools: [{ name: "echo", description: "Fixture", inputSchema: { type: "object", properties: {} } }] }
    }, { headers: { "Mcp-Session-Id": "fixture-session" } });
  } });
  try {
    const tools = new SessionTools();
    const registry = installMcpServer(emptyExtensionRegistry(), { name: "fixture", url: `${server.url.origin}/mcp` });
    const result = await tools.mcp(`discover ${registry.servers[0]!.id}`, registry);
    expect(result.message).toContain("_echo");
    expect(methods).toContain("tools/list");
    expect(methods).not.toContain("tools/call");
    expect(closed).toBe(true);
    const name = [...tools.discovered][0]!;
    tools.select(name, false, registry);
    expect(tools.disabled.has(name)).toBe(true);
  } finally { await server.stop(true); }
});

import { approvedFreeModels } from "../packages/cli/src/models";
import type { ModelConfig } from "../packages/contracts/src";
test("CLI hosted selection accepts only approved zero-cost Beam catalog entries", () => {
  const beam: ModelConfig = { id: "reflection/beam-free", provider: "reflection", approved: true, byok: false, inputMicrosPerToken: 0, outputMicrosPerToken: 0, maxContextTokens: 1000 };
  expect(approvedFreeModels([beam, { ...beam, inputMicrosPerToken: 1 }, { ...beam, outputMicrosPerToken: 1 }, { ...beam, id: "paid" }, { ...beam, approved: false }, { ...beam, byok: true }])).toEqual([beam]);
});
