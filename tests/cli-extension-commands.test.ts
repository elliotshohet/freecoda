import { expect, test } from "bun:test";
import { extensionInventory, extensionRequest, showExtension } from "../packages/cli/src/extension-commands";
import { installSkillFromText } from "../packages/core/src/extensions";

test("only explicit extension commands route installation, with no execution", () => {
  expect(extensionRequest("install this skill https://example.com/SKILL.md")).toEqual({ action: "install-skill", source: "https://example.com/SKILL.md" });
  expect(extensionRequest("/skills install /tmp/reference/SKILL.md")).toEqual({ action: "install-skill", source: "/tmp/reference/SKILL.md" });
  expect(() => extensionRequest("/skills install")).toThrow("Use /skills install");
  expect(extensionRequest("Could you install this skill someday?")).toBeNull();
  expect(extensionRequest("/install mcp Example https://example.com/mcp")).toEqual({ action: "install-mcp", name: "Example", url: "https://example.com/mcp" });
  expect(() => extensionRequest("/install run shell")).toThrow("Use /install");
  expect(extensionRequest("/skills reference")).toEqual({ action: "list", query: "reference" });
});

test("installed skill instructions are viewable without executing support files", () => {
  const registry = installSkillFromText({ version: 1, skills: [], servers: [] }, { name: "Reference", source: "uploaded:reference", instructions: "# Read carefully\nNever execute scripts without approval." });
  const text = showExtension(registry, registry.skills[0]!.id);
  expect(text).toContain("# Read carefully");
  expect(text).toContain("Never execute scripts without approval.");
  expect(() => showExtension(registry, "missing")).toThrow("No installed extension");
});

test("extension inventory groups installed members without claiming connectivity or exposing headers", () => {
  const registry = {
    version: 1 as const,
    plugins: [{ id: "bundle", name: "Reference bundle", source: "https://example.com/plugin.json", skillIds: [], serverIds: ["example"] }],
    skills: [],
    servers: [{ id: "example", name: "Example", url: "https://example.com/mcp", enabled: true, headers: { Authorization: "private-token" } }],
  };
  const inventory = extensionInventory(registry);
  expect(inventory).toContain("Installed plugins");
  expect(inventory).toContain("MCP connections");
  expect(inventory).toContain("No skills installed.");
  expect(inventory).toContain("enabled for next Build turn");
  expect(inventory).toContain("not a verified connection");
  expect(inventory).not.toContain("private-token");
  expect(extensionInventory(registry, "missing")).toContain("No matching MCP connections.");
  expect(extensionInventory(registry, "", "mcp")).not.toContain("Installed plugins");
  expect(showExtension(registry, "bundle")).toContain("MCP connections: example");
  expect(showExtension(registry, "example")).not.toContain("private-token");
});
