import { expect, test } from "bun:test";
import { discoverProjectTools, publicProjectExtensions, selectProjectTools, extensionActionSchema } from "../apps/web/lib/cloud/extensions";
import { installMcpServer, emptyExtensionRegistry } from "../packages/core/src/extensions";

test("explicit discovery lists actual tools, denies execution approval and closes connection", async () => {
  const registry = installMcpServer(emptyExtensionRegistry(), { name: "Fixture", url: "https://example.com/mcp" });
  let closed = 0;
  let executed = 0;
  const result = await discoverProjectTools(registry, registry.servers[0].id, async (selected, options) => {
    expect(selected.skills).toEqual([]);
    expect(selected.servers).toHaveLength(1);
    expect(selected.servers[0].enabled).toBe(true);
    expect(options.allowLocal).toBe(false);
    expect(await options.approve("shell", "fixture")).toBe(false);
    return { tools: { mcp_fixture_actual: { description: "Actual discovered tool", execute: async () => { executed++; } } }, instructions: "", close: async () => { closed++; } } as any;
  });
  expect(result.tools).toEqual([{ name: "mcp_fixture_actual", description: "Actual discovered tool" }]);
  expect(Number.isFinite(Date.parse(result.checkedAt))).toBe(true);
  expect(closed).toBe(1);
  expect(executed).toBe(0);
});

test("failed discovery exposes no server diagnostics or invented availability", async () => {
  const registry = installMcpServer(emptyExtensionRegistry(), { name: "Fixture", url: "https://example.com/mcp" });
  await expect(discoverProjectTools(registry, registry.servers[0].id, async () => { throw new Error("private credential"); })).rejects.toThrow("MCP tool discovery failed.");
  const view = publicProjectExtensions({ extensions: registry });
  expect(view.servers[0].status).toBe("not-checked");
  expect(view.servers[0].tools).toEqual([]);
});

test("tool switches only remove constructed tools and cannot add mode-forbidden tools", () => {
  const readOnly = { list_files: { marker: 1 }, read_file: { marker: 2 } };
  expect(selectProjectTools(readOnly, ["read_file", "shell", "mcp_unknown"])).toEqual({ list_files: readOnly.list_files });
  expect(selectProjectTools(readOnly)).toBeDefined();
  expect(selectProjectTools(readOnly)).not.toHaveProperty("shell");
  expect(extensionActionSchema.safeParse({ action: "discover", id: "mcp_fixture" }).success).toBe(true);
  expect(extensionActionSchema.safeParse({ action: "tool-toggle", name: "read_file", enabled: false }).success).toBe(true);
});

test("discovery closes an opened connection even when catalog inspection fails", async () => {
  const registry = installMcpServer(emptyExtensionRegistry(), { name: "Fixture", url: "https://example.com/mcp" });
  let closed = false;
  await expect(discoverProjectTools(registry, registry.servers[0].id, async () => ({
    get tools() { throw new Error("private transport failure"); },
    instructions: "",
    close: async () => { closed = true; },
  }) as any)).rejects.toThrow("MCP tool discovery failed.");
  expect(closed).toBe(true);
});


test("plugin requests reject executable or credential-bearing manifest fields", () => {
  const base = { action: "plugin-install", source: "https://example.com/plugin.json", manifest: { version: 1, name: "Fixture", skills: [], servers: [{ name: "Fixture", url: "https://example.com/mcp" }] } };
  expect(extensionActionSchema.safeParse(base).success).toBe(true);
  expect(extensionActionSchema.safeParse({ ...base, manifest: { ...base.manifest, script: "run me" } }).success).toBe(false);
  expect(extensionActionSchema.safeParse({ ...base, manifest: { ...base.manifest, servers: [{ ...base.manifest.servers[0], headers: { Authorization: "private" } }] } }).success).toBe(false);
});
