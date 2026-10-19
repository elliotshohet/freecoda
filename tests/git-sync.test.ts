import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { githubRepositoryIdentity, repositorySyncStatus, pullRepository } from "../packages/core/src/git-sync";

const fixtures: string[] = [];
function git(root: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" } }).trim();
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "freecoda-sync-")); fixtures.push(root);
  git(root, "init", "--bare", "origin.git");
  git(root, "clone", join(root, "origin.git"), "first");
  const first = join(root, "first");
  await writeFile(join(first, "file.txt"), "initial"); git(first, "add", "."); git(first, "commit", "-m", "initial"); git(first, "push", "-u", "origin", "HEAD");
  git(root, "clone", join(root, "origin.git"), "second");
  return { first, second: join(root, "second") };
}
afterEach(async () => { await Promise.all(fixtures.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
test("identity supports standard GitHub remotes without exposing credentials", () => {
  expect(githubRepositoryIdentity("git@github.com:Owner/Repo.git")).toBe("owner/repo");
  expect(githubRepositoryIdentity("https://github.com/Owner/Repo.git")).toBe("owner/repo");
  expect(githubRepositoryIdentity("https://token@github.com/Owner/Repo.git")).toBeNull();
});
test("pull downloads committed changes without creating commits or running merge hooks", async () => {
  const { first, second } = await setup();
  await writeFile(join(first, "file.txt"), "remote"); git(first, "commit", "-am", "remote"); git(first, "push");
  await writeFile(join(second, ".git/hooks/post-merge"), "#!/bin/sh\ntouch HOOK_RAN\n", { mode: 0o755 });
  const result = await pullRepository(second);
  expect(await readFile(join(second, "file.txt"), "utf8")).toBe("remote");
  expect(result.ahead).toBe(0); expect(result.behind).toBe(0); expect(result.dirty).toBe(false);
  expect(git(second, "rev-parse", "HEAD")).toBe(git(first, "rev-parse", "HEAD"));
});
test("dirty and untracked work is preserved and blocks pulling", async () => {
  const { second } = await setup();
  await writeFile(join(second, "local.txt"), "keep");
  expect((await repositorySyncStatus(second)).dirty).toBe(true);
  await expect(pullRepository(second)).rejects.toThrow("local changes");
  expect(await readFile(join(second, "local.txt"), "utf8")).toBe("keep");
});
test("divergent clean history is never merged or reset", async () => {
  const { first, second } = await setup();
  await writeFile(join(first, "remote.txt"), "remote"); git(first, "add", "."); git(first, "commit", "-m", "remote"); git(first, "push");
  await writeFile(join(second, "local.txt"), "local"); git(second, "add", "."); git(second, "commit", "-m", "local");
  const head = git(second, "rev-parse", "HEAD");
  await expect(pullRepository(second)).rejects.toThrow("diverged");
  expect(git(second, "rev-parse", "HEAD")).toBe(head);
});
test("unfinished Git operations block pulling even when the tree is clean", async () => {
  const { second } = await setup();
  await writeFile(join(second, ".git/MERGE_HEAD"), `${git(second, "rev-parse", "HEAD")}\n`);
  expect((await repositorySyncStatus(second)).operationInProgress).toBe(true);
  await expect(pullRepository(second)).rejects.toThrow("current Git operation");
});
