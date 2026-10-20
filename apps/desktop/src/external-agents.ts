import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export type ExternalAgentId = "codex" | "claude";
export type ExternalAgentAvailability = {
  id: ExternalAgentId;
  name: string;
  installed: boolean;
  authentication: "not-checked";
  integration: "interactive-terminal";
  detail: string;
};
const agents: Record<ExternalAgentId, { name: string; command: string }> = {
  codex: { name: "Codex", command: "codex" },
  claude: { name: "Claude Code", command: "claude" },
};

/** Filesystem-only discovery. Never starts a CLI, reads credentials, or installs. */
export async function findExternalAgentExecutable(id: ExternalAgentId): Promise<string | undefined> {
  if (!Object.hasOwn(agents, id)) throw Error("Unknown external agent.");
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    // Relative PATH entries could select a workspace-controlled executable.
    if (!path.isAbsolute(directory)) continue;
    try {
      const candidate = await realpath(path.join(directory, agents[id].command));
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* Missing or inaccessible entries are not installed candidates. */ }
  }
}

export async function discoverExternalAgents(): Promise<ExternalAgentAvailability[]> {
  return Promise.all((Object.keys(agents) as ExternalAgentId[]).map(async id => {
    const installed = !!await findExternalAgentExecutable(id);
    return {
      id,
      name: agents[id].name,
      installed,
      authentication: "not-checked" as const,
      integration: "interactive-terminal" as const,
      detail: installed
        ? "Installed command found. Connecting requires your explicit consent. The CLI uses its own account, configuration, permissions, and billing; Freecoda's free hosted allowance does not apply. Sign-in status is checked by the CLI after connection."
        : `Install ${agents[id].name} yourself using its official instructions, then restart Freecoda if PATH changed. No installation or sign-in was attempted.`,
    };
  }));
}

/** Published CLI interfaces, not an emulated managed-agent protocol.
 * Codex: https://developers.openai.com/codex/cli/reference/
 * Claude: https://code.claude.com/docs/en/cli-reference
 * Documentation inspected October 20, 2026. No upstream code is copied.
 */
export function externalAgentArguments(id: ExternalAgentId): string[] {
  if (id === "codex") return ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"];
  if (id === "claude") return ["--permission-mode", "default"];
  throw Error("Unknown external agent.");
}
