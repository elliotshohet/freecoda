import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const execute = promisify(execFile);
async function git(root: string, args: string[]): Promise<string> {
  try {
    const result = await execute("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return result.stdout.trim();
  } catch {
    // Git stderr can contain credential-bearing remote URLs. Never forward it to clients.
    throw new Error(`Git ${args[0]} failed. Check the checkout, Git authentication, and repository access in your terminal.`);
  }
}

/** GitHub identity only; never expose embedded credentials from a remote URL. */
export function githubRepositoryIdentity(remote: string): string | null {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

export type RepositorySyncStatus = {
  repository: string | null;
  branch: string | null;
  upstream: string | null;
  dirty: boolean;
  conflicts: boolean;
  operationInProgress: boolean;
  ahead: number;
  behind: number;
};

export async function repositorySyncStatus(root: string): Promise<RepositorySyncStatus> {
  const branch = await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => null);
  const upstream = await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).catch(() => null);
  const remote = await git(root, ["remote", "get-url", "origin"]).catch(() => "");
  const changes = await git(root, ["status", "--porcelain=v1", "--untracked-files=normal"]);
  const conflicts = Boolean(await git(root, ["diff", "--name-only", "--diff-filter=U"]));
  const operationInProgress = (await Promise.all(["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"].map(async name => {
    const location = await git(root, ["rev-parse", "--git-path", name]);
    return access(resolve(root, location)).then(() => true, () => false);
  }))).some(Boolean);
  const counts = upstream ? (await git(root, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])).split(/\s+/).map(Number) : [0, 0];
  return { repository: githubRepositoryIdentity(remote), branch, upstream, dirty: Boolean(changes), conflicts, operationInProgress, ahead: counts[0], behind: counts[1] };
}

/** Explicit download only. Never stages, commits, pushes, stashes, resets or merges divergent history. */
export async function pullRepository(root: string): Promise<RepositorySyncStatus> {
  const before = await repositorySyncStatus(root);
  if (before.operationInProgress) throw new Error("Finish or abort the current Git operation before pulling.");
  if (!before.branch || !before.upstream) throw new Error("Check out a branch with an upstream before pulling.");
  if (!before.upstream.startsWith("origin/")) throw new Error("Only an origin tracking branch can be pulled. Check your repository configuration.");
  if (before.dirty || before.conflicts) throw new Error("Commit or resolve local changes, including untracked files, before pulling. No files were changed.");
  await git(root, ["fetch", "--no-recurse-submodules", "origin"]);
  const current = await repositorySyncStatus(root);
  if (current.branch !== before.branch || current.upstream !== before.upstream || current.dirty || current.conflicts || current.operationInProgress) throw new Error("The checkout changed while fetching. Review its status before retrying.");
  if (current.ahead && current.behind) throw new Error("Local and remote commits have diverged. Resolve them explicitly; no merge was attempted.");
  if (current.behind) {
    const target = await git(root, ["rev-parse", "--verify", "@{upstream}^{commit}"]);
    await git(root, ["merge", "--ff-only", "--no-edit", target]);
  }
  return repositorySyncStatus(root);
}
