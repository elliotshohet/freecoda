import { expect, test } from "bun:test";
import { emptyExtensionRegistry, fetchPluginManifest, installPlugin, removePlugin, removeExtension, setExtensionEnabled, parseExtensionRegistry, publicExtensions } from "../packages/core/src/extensions";
import { pluginManifestSchema } from "../packages/contracts/src/extensions";

test("plugin schemas reject executable/unknown fields and empty bundles", () => {
  expect(() => pluginManifestSchema.parse({ version: 1, name: "Bad", skills: [], servers: [], scripts: ["evil"] })).toThrow();
  expect(() => pluginManifestSchema.parse({ version: 1, name: "Empty" })).toThrow();
});

test("plugin installs real bounded skill and MCP data transactionally without executing tools", async () => {
  let toolsRequested = false;
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request): Response {
    if (new URL(request.url).pathname === "/SKILL.md") return new Response("# Fixture skill\nRead before making edits.");
    if (new URL(request.url).pathname === "/missing") return new Response("missing", { status: 404 });
    if (new URL(request.url).pathname === "/large") return new Response("x".repeat(32_001));
    if (new URL(request.url).pathname === "/mcp") { toolsRequested = true; return new Response("must not connect"); }
    return Response.json({ version: 1, name: "Fixture plugin", skills: [{ source: `${server.url}SKILL.md` }], servers: [{ name: "Fixture", url: `${server.url}mcp` }] });
  } });
  try {
    const source = `${server.url}plugin.json`;
    const manifest = await fetchPluginManifest(source, { allowLocal: true });
    const previous = emptyExtensionRegistry();
    const installed = await installPlugin(previous, { manifest, source, allowLocal: true });
    expect(previous.skills).toHaveLength(0);
    expect(previous.servers).toHaveLength(0);
    expect(installed.skills[0]!.instructions).toContain("Fixture skill");
    expect(installed.servers[0]!.url).toBe(`${server.url}mcp`);
    expect(toolsRequested).toBe(false);
    expect(publicExtensions(installed).plugins).toHaveLength(1);
    await expect(installPlugin(installed, { manifest, source, allowLocal: true })).rejects.toThrow("already installed");
    await expect(installPlugin(previous, { manifest: { ...manifest, skills: [...manifest.skills, { source: `${server.url}missing` }] }, source, allowLocal: true })).rejects.toThrow("download");
    expect(previous.skills).toHaveLength(0);
    expect(previous.plugins).toBeUndefined();
    await expect(installPlugin({ ...installed, plugins: undefined }, { manifest, source, allowLocal: true })).rejects.toThrow("conflicts");
    await expect(installPlugin(previous, { manifest: { ...manifest, servers: [...manifest.servers, ...manifest.servers] }, source, allowLocal: true })).rejects.toThrow("conflicts");
    await expect(fetchPluginManifest(`${server.url}large`, { allowLocal: true })).rejects.toThrow("32KB");
    await expect(fetchPluginManifest(source)).rejects.toThrow();
    const group = installed.plugins![0]!;
    expect(() => parseExtensionRegistry({ ...installed, plugins: [{ ...group, skillIds: [...group.skillIds, ...group.skillIds] }] })).toThrow("ownership");
    expect(() => parseExtensionRegistry({ ...installed, plugins: [group, { ...group, id: "plugin_other" }] })).toThrow("ownership");
    expect(() => parseExtensionRegistry({ ...installed, plugins: [{ ...group, id: installed.skills[0]!.id }] })).toThrow("IDs");
    const toggled = setExtensionEnabled(installed, installed.skills[0]!.id, false);
    expect(toggled.plugins).toEqual(installed.plugins);
    const individual = removeExtension(installed, installed.skills[0]!.id);
    expect(individual.plugins![0]!.skillIds).toHaveLength(0);
    expect(individual.plugins![0]!.serverIds).toHaveLength(1);
    expect(removeExtension(individual, installed.servers[0]!.id).plugins).toHaveLength(0);
    const removed = removePlugin(installed, installed.plugins![0]!.id);
    expect(removed.skills).toHaveLength(0);
    expect(removed.servers).toHaveLength(0);
  } finally { server.stop(true); }
});
