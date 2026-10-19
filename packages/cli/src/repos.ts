import type { Command } from "commander";
import { validateBaseURL, repositorySyncStatus, pullRepository } from "@freecoda/core";
import { loadConfig } from "./config";
import { safeTerminalText } from "./ui";

type Repository = { repositoryId: number; installationId: number; owner: string; name: string; defaultBranch: string; private: boolean };
type Setting = Omit<Repository, "defaultBranch" | "private"> & { branch: string; appDirectory: string; enabled: boolean };
async function request(path: string, body?: unknown) {
  const config = await loadConfig();
  if (!config.token) throw new Error("Sign in with freecoda login before configuring connected repositories.");
  const response = await fetch(`${validateBaseURL(config.server)}/api/v1/github/${path}`, {
    method: body === undefined ? "GET" : "PUT",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error", signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json() as any;
  if (!response.ok) throw new Error(safeTerminalText(result.error || `Server returned ${response.status}.`));
  return result;
}
export function registerRepoCommands(program: Command) {
  const repos = program.command("repos").description("Manage account GitHub repository settings shared by web, desktop, and CLI; does not clone or trust local code");
  repos.command("status").description("Show local GitHub identity, branch, local changes, and last fetched upstream status")
    .option("--root <path>", "Local checkout", ".")
    .action(async (options: { root: string }) => console.log(JSON.stringify(await repositorySyncStatus(options.root), null, 2)));
  repos.command("pull").description("Explicitly fetch origin and fast-forward a clean checkout; never uploads or overwrites local changes")
    .option("--root <path>", "Trusted local checkout", ".")
    .action(async (options: { root: string }) => console.log(JSON.stringify(await pullRepository(options.root), null, 2)));
  repos.command("list").description("List accessible installed GitHub repositories and installation link").action(async () => console.log(JSON.stringify(await request("repos"), null, 2)));
  repos.command("configured").description("Show account repository settings").action(async () => console.log(JSON.stringify(await request("repositories"), null, 2)));
  repos.command("configure <repository>").description("Save OWNER/NAME settings for your connected account")
    .option("--installation <id>", "Select installation when multiple installations contain this repository")
    .option("--branch <branch>", "Repository branch (defaults to GitHub's default branch)")
    .option("--directory <path>", "App directory relative to repository root", "")
    .option("--disable", "Keep configuration disabled")
    .action(async (repository: string, options: { installation?: string; branch?: string; directory: string; disable?: boolean }) => {
      const parts = repository.split("/");
      if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part))) throw new Error("Use OWNER/NAME.");
      const available = (await request("repos")).repos as Repository[];
      const matches = available.filter(repo => `${repo.owner}/${repo.name}`.toLowerCase() === repository.toLowerCase() && (!options.installation || String(repo.installationId) === options.installation));
      if (matches.length !== 1) throw new Error("Select an accessible repository from freecoda repos list; use --installation if needed.");
      const repo = matches[0];
      const current = (await request("repositories")).repositories as Setting[];
      const setting: Setting = { repositoryId: repo.repositoryId, installationId: repo.installationId, owner: repo.owner, name: repo.name, branch: options.branch || repo.defaultBranch, appDirectory: options.directory, enabled: !options.disable };
      console.log(JSON.stringify(await request("repositories", { repositories: [...current.filter(entry => entry.repositoryId !== repo.repositoryId), setting] }), null, 2));
    });
  repos.command("remove <repository>").description("Remove account configuration without disconnecting the GitHub App")
    .action(async (repository: string) => {
      const current = (await request("repositories")).repositories as Setting[];
      const retained = current.filter(repo => `${repo.owner}/${repo.name}`.toLowerCase() !== repository.toLowerCase());
      if (retained.length === current.length) throw new Error("That repository is not configured.");
      console.log(JSON.stringify(await request("repositories", { repositories: retained }), null, 2));
    });
}
