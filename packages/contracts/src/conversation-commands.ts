export type ConversationCommandClient = "web" | "desktop" | "cli";

export type ConversationCommand = {
  name: string;
  description: string;
  usage: string;
  clients: readonly ConversationCommandClient[];
};

const all = ["web", "desktop", "cli"] as const;
const graphical = ["web", "desktop"] as const;

/** Discovery metadata only. Each client must enforce its own context and permissions. */
export const CONVERSATION_COMMANDS: readonly ConversationCommand[] = [
  { name: "/help", description: "Browse conversation commands", usage: "/help", clients: all },
  { name: "/new", description: "Start a new conversation", usage: "/new", clients: all },
  { name: "/clear", description: "Start a fresh chat and clear the view; keep saved history", usage: "/clear", clients: all },
  { name: "/resume", description: "Choose a saved conversation to continue", usage: "/resume", clients: all },
  { name: "/copy", description: "Copy the latest completed assistant response", usage: "/copy", clients: all },
  { name: "/diff", description: "Review repository changes", usage: "/diff", clients: all },
  { name: "/pwd", description: "Show the current project working directory", usage: "/pwd", clients: all },
  { name: "/cwd", description: "Show the current project working directory", usage: "/cwd", clients: all },
  { name: "/project", description: "Choose a project or repository", usage: "/project", clients: graphical },
  { name: "/chat", description: "Continue without project access", usage: "/chat", clients: all },
  { name: "/build", description: "Work on a selected project with approvals", usage: "/build", clients: all },
  { name: "/plan", description: "Plan project work with read-only tools", usage: "/plan", clients: all },
  { name: "/review", description: "Review a project with read-only tools", usage: "/review", clients: all },
  { name: "/model", description: "Choose an available model", usage: "/model", clients: all },
  { name: "/permissions", description: "Review project permissions", usage: "/permissions", clients: all },
  { name: "/tools", description: "Browse available tools and access", usage: "/tools", clients: all },
  { name: "/mcp", description: "Browse MCP server connections", usage: "/mcp", clients: all },
  { name: "/skills", description: "Browse skills or prepare a skill installation", usage: "/skills [install URL]", clients: all },
  { name: "/extensions", description: "Manage tools, MCP servers, and skills", usage: "/extensions", clients: all },
  { name: "/plugins", description: "Manage plugins, connections, and skills", usage: "/plugins [install URL]", clients: all },
  { name: "/repos", description: "Find and configure connected repositories", usage: "/repos", clients: graphical },
  { name: "/files", description: "Open project files", usage: "/files", clients: graphical },
  { name: "/sync", description: "Inspect or pull the selected repository", usage: "/sync [status|pull]", clients: graphical },
  { name: "/status", description: "Show connection and project status", usage: "/status", clients: all },
  { name: "/usage", description: "View account usage", usage: "/usage", clients: all },
  { name: "/update", description: "Check updates for this client", usage: "/update", clients: ["desktop", "cli"] },
  { name: "/terminal", description: "Open the local command panel", usage: "/terminal", clients: ["desktop"] },
  { name: "/changes", description: "Review project changes", usage: "/changes", clients: ["web"] },
  { name: "/preview", description: "Open the project preview", usage: "/preview", clients: ["web"] },
  { name: "/output", description: "View project activity and output", usage: "/output", clients: ["web"] },
  { name: "/start", description: "Start the selected cloud project compute", usage: "/start", clients: ["web"] },
  { name: "/suspend", description: "Suspend the selected cloud project", usage: "/suspend", clients: ["web"] },
];

export function conversationCommandsFor(client: ConversationCommandClient) {
  return CONVERSATION_COMMANDS.filter(command => command.clients.includes(client));
}

export function filterConversationCommands(query: string, client: ConversationCommandClient, limit = 8) {
  const term = query.trim().replace(/^\//, "").toLowerCase();
  if (/\s/.test(term)) return [];
  const commands = conversationCommandsFor(client);
  const matches = commands.filter(command => !term || command.name.slice(1).startsWith(term) || command.description.toLowerCase().includes(term));
  matches.sort((a, b) => Number(b.name.slice(1).startsWith(term)) - Number(a.name.slice(1).startsWith(term)));
  return matches.slice(0, Math.max(0, Math.min(50, limit)));
}

/** Unknown slash commands are returned too, so clients never submit them as model prompts. */
export function parseConversationCommand(input: string): { name: string; argument: string } | null {
  const value = input.trim();
  if (!value.startsWith("/")) return null;
  const match = /^(\/\S+)(?:\s+([\s\S]*))?$/.exec(value);
  return { name: match?.[1].toLowerCase() || "/", argument: match?.[2]?.trim() || "" };
}

/** Installation intent opens a review flow; it never grants access or installs anything. */
export function parseSkillInstallIntent(input: string): { source: string | null } | null {
  const value = input.trim();
  const match = /^(?:\/skills\s+install|install\s+(?:this\s+)?skill)(?:\s+([\s\S]+))?$/i.exec(value);
  if (!match) return null;
  return { source: match[1]?.trim() || null };
}

export function parsePluginInstallIntent(input: string): { source: string | null } | null {
  const match = /^(?:\/plugins\s+install|install\s+(?:this\s+)?plugin)(?:\s+([\s\S]+))?$/i.exec(input.trim());
  return match ? { source: match[1]?.trim() || null } : null;
}

/** Compatibility replies, deliberately excluded from command discovery. */
const UNSUPPORTED_CODEX_COMMANDS = {
  "/fork": "Freecoda does not support branching a conversation. Use /new to start a separate conversation.",
  "/compact": "Freecoda does not provide manual conversation compaction. Use /new for a fresh conversation; saved history is preserved.",
  "/agents": "Freecoda does not provide a multi-agent session manager.",
  "/subagents": "Freecoda does not support spawning or managing subagents.",
  "/goal": "Freecoda does not support autonomous goals or goal budgets.",
  "/worktree": "Freecoda does not provide worktree creation or management through slash commands.",
  "/fast": "Freecoda does not provide a fast-mode toggle. Use /model to choose an available free model.",
  "/apps": "Freecoda does not support Codex connected apps. Use /plugins to manage Freecoda skills and MCP servers.",
  "/init": "Freecoda does not generate AGENTS.md through a slash command. Request a file change in a trusted project with the usual approvals.",
  "/rename": "Freecoda does not provide conversation renaming through slash commands.",
  "/archive": "Freecoda does not support conversation archiving through slash commands.",
  "/delete": "Freecoda does not delete conversations through slash commands. Use the conversation history controls to review available actions.",
  "/import": "Freecoda does not support importing Codex conversations.",
  "/approve": "Freecoda does not approve tool actions through slash commands. Use the approval controls for the specific pending action.",
} as const;

export type UnsupportedCodexCommand = keyof typeof UNSUPPORTED_CODEX_COMMANDS;

/** Returns a limitation for a recognized unsupported command; unknown names remain unknown. */
export function codexUnsupportedCommand(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  const command = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return Object.prototype.hasOwnProperty.call(UNSUPPORTED_CODEX_COMMANDS, command)
    ? UNSUPPORTED_CODEX_COMMANDS[command as UnsupportedCodexCommand]
    : null;
}
