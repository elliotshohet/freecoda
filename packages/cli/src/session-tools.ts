import {
  connectExtensionTools,
  setExtensionEnabled,
  publicExtensions,
  type ExtensionRegistry,
} from "@freecoda/core";

export const nativeToolNames = ["list_files", "read_file", "search", "write_file", "replace_text", "shell"];

/** Session selections can only remove tools from the mode/permission allowed set. */
export class SessionTools {
  disabled = new Set<string>();
  discovered = new Set<string>();

  names(registry: ExtensionRegistry) {
    return [...nativeToolNames, ...(registry.skills.some((skill) => skill.enabled) ? ["skill_file"] : []), ...this.discovered];
  }

  select(name: string, enabled: boolean, registry: ExtensionRegistry) {
    if (!this.names(registry).includes(name)) throw Error("Unknown tool. Use /mcp discover <server-id> to discover external tools first.");
    if (enabled) this.disabled.delete(name);
    else this.disabled.add(name);
  }

  async mcp(command: string, registry: ExtensionRegistry): Promise<{ registry: ExtensionRegistry; message: string }> {
    const [action, id, ...extra] = command.trim().split(/\s+/);
    if (!command.trim()) return {
      registry,
      message: JSON.stringify(publicExtensions(registry).servers, null, 2) + "\n/mcp enable|disable <server-id> · /mcp discover <server-id>\nInstall: freecoda extensions add-mcp <name> <url>. Connections apply next turn; Chat and read-only modes never connect to MCP.",
    };
    if (extra.length || !id || !["enable", "disable", "discover"].includes(action!)) throw Error("Use /mcp, /mcp enable|disable <server-id>, or /mcp discover <server-id>.");
    const server = registry.servers.find((item) => item.id === id);
    if (!server) throw Error("Unknown MCP server. Use /mcp to list installed connections.");
    if (action !== "discover") return {
      registry: setExtensionEnabled(registry, id, action === "enable"),
      message: `MCP connection ${action}d for the next turn. Tool calls still follow the current mode and approval policy.`,
    };
    if (!server.enabled) throw Error("Enable this connection explicitly before discovering its tools.");
    const runtime = await connectExtensionTools({ version: 1, servers: [server], skills: [] }, {
      approve: async () => false,
      allowLocal: true,
      signal: AbortSignal.timeout(20_000),
    });
    try {
      const names = Object.keys(runtime.tools);
      for (const name of names) this.discovered.add(name);
      return { registry, message: (names.join("\n") || "No tools advertised.") + "\nDiscovery completed; no tools executed. Use /tools disable|enable <name> to select tools for following turns." };
    } finally { await runtime.close(); }
  }
}
