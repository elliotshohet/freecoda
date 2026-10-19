import { parseSkillInstallIntent } from "@freecoda/contracts";
import type { ExtensionRegistry } from "@freecoda/contracts";

export type ExtensionRequest =
  | { action: "list"; query: string }
  | { action: "show"; id: string }
  | { action: "install-skill"; source: string }
  | { action: "install-mcp"; name: string; url: string };

/** Exact, user-authored commands only; model output never installs extensions. */
export function extensionRequest(input: string): ExtensionRequest | null {
  const natural = parseSkillInstallIntent(input);
  if (natural) {
    if (!natural.source) throw new Error("Use /skills install <path or HTTPS SKILL.md URL>.");
    return { action: "install-skill", source: natural.source };
  }
  const match = input.match(/^\/(skills|extensions|install)(?:\s+(.*))?$/s);
  if (!match) return null;
  const args = (match[2] || "").trim();
  if (match[1] !== "install") {
    if (args.startsWith("show ")) return { action: "show", id: args.slice(5).trim() };
    return { action: "list", query: args };
  }
  const skill = args.match(/^skill\s+(.+)$/s);
  if (skill) return { action: "install-skill", source: skill[1]!.trim() };
  const mcp = args.match(/^mcp\s+(\S+)\s+(\S+)$/);
  if (mcp) return { action: "install-mcp", name: mcp[1]!, url: mcp[2]! };
  throw new Error("Use /install skill <path or HTTPS SKILL.md URL> or /install mcp <name> <url>.");
}

/** Local inventory only: installation and enablement do not prove connectivity. */
export function extensionInventory(registry: ExtensionRegistry, query = "", section?: "plugins" | "mcp"): string {
  const needle = query.trim().toLowerCase();
  const matches = (item: { id: string; name: string }) => `${item.name} ${item.id}`.toLowerCase().includes(needle);
  const groups: string[] = [];
  if (section !== "mcp") {
    const plugins = (registry.plugins || []).filter(matches);
    groups.push("Installed plugins", ...(plugins.length ? plugins.map(item => `  ${item.name} · ${item.id}\n    ${item.skillIds.length} skills · ${item.serverIds.length} MCP connections`) : [needle ? "  No matching plugins." : "  No plugins installed."]));
  }
  if (section !== "plugins") {
    const servers = registry.servers.filter(item => matches(item) || (needle && "mcp".includes(needle)));
    groups.push("", "MCP connections", ...(servers.length ? servers.map(item => `  ${item.name} · ${item.id}\n    Installed · ${item.enabled ? "enabled for next Build turn" : "disabled"}\n    ${item.url}`) : [needle ? "  No matching MCP connections." : "  No MCP connections installed."]));
    if (section !== "mcp") {
      const skills = registry.skills.filter(item => matches(item) || (needle && "skill".includes(needle)));
      groups.push("", "Skills", ...(skills.length ? skills.map(item => `  ${item.name} · ${item.id}\n    Installed · ${item.enabled ? "enabled" : "disabled"}`) : [needle ? "  No matching skills." : "  No skills installed."]));
    }
  }
  groups.push("", section === "plugins" ? "/plugins install <manifest URL> reviews a bundle. freecoda plugins remove <id> removes it." : section === "mcp" ? "/mcp enable|disable <id> · /mcp discover <id> · /install mcp <name> <url>" : "/extensions show <id> · /plugins · /mcp · /tools\n/install skill <source> · /install mcp <name> <url>");
  groups.push("Local installation only. Enabled is a selection, not a verified connection. Chat has no tools; workspace trust, mode, and execution permissions still apply.");
  return groups.join("\n").trim();
}

export function showExtension(registry: ExtensionRegistry, id: string): string {
  const skill = registry.skills.find(item => item.id === id);
  if (skill) return `Skill: ${skill.name}\nID: ${skill.id}\nSource: ${skill.source || "Not recorded"}\nInstalled · ${skill.enabled ? "enabled" : "disabled"}\n\n${skill.instructions}\n\nSupporting files: ${Object.keys(skill.files || {}).join(", ") || "none"}\nInstructions cannot override workspace permissions.`;
  const server = registry.servers.find(item => item.id === id);
  if (server) return `MCP connection: ${server.name}\nID: ${server.id}\nEndpoint: ${server.url}\nInstalled · ${server.enabled ? "enabled for next Build turn" : "disabled"}\nEnablement does not verify connectivity or grant account access.\n/mcp discover ${server.id} lists actual tools without executing them.\n/mcp enable|disable ${server.id} changes next-turn selection.`;
  const plugin = registry.plugins?.find(item => item.id === id);
  if (plugin) return `Plugin: ${plugin.name}\nID: ${plugin.id}\nSource: ${plugin.source}\nInstalled\nSkills: ${plugin.skillIds.join(", ") || "none"}\nMCP connections: ${plugin.serverIds.join(", ") || "none"}\nUse /extensions show <member-id> to inspect a member. Installation does not verify connections.\nfreecoda plugins remove ${plugin.id} removes this bundle and its members.`;
  throw new Error("No installed extension has that ID. Use /extensions to browse.");
}
