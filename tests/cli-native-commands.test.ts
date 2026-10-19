import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { latestAssistantText, workspaceDiff } from "../packages/cli/src/native-commands";

const execute = promisify(execFile);

test("copy selects the latest textual assistant response, not tools or user content", () => {
  expect(latestAssistantText([{ role: "user", content: "private prompt" }])).toBeNull();
  expect(latestAssistantText([
    { role: "assistant", content: "Earlier" },
    { role: "assistant", content: [{ type: "text", text: "Latest" }] },
    { role: "user", content: "Next prompt" },
  ])).toBe("Latest");
});

test("diff reports staged and unstaged changes plus untracked paths, while respecting ignores", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-diff-"));
  const git = (...args: string[]) => execute("git", args, { cwd: root });
  try {
    await git("init");
    await writeFile(path.join(root, ".gitignore"), "ignored.txt\n");
    await writeFile(path.join(root, "tracked.txt"), "original\n");
    await git("add", ".");
    await git("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "Initial");
    expect(await workspaceDiff(root)).toBe("No staged, unstaged, or untracked changes.");
    await writeFile(path.join(root, "tracked.txt"), "staged\n");
    await git("add", "tracked.txt");
    await writeFile(path.join(root, "tracked.txt"), "unstaged\n");
    await writeFile(path.join(root, "new.txt"), "untracked content is not printed\n");
    await writeFile(path.join(root, "ignored.txt"), "ignored content\n");
    const diff = await workspaceDiff(root);
    expect(diff).toContain("Staged changes");
    expect(diff).toContain("Unstaged changes");
    expect(diff).toContain("Untracked files (paths only)\nnew.txt");
    expect(diff).not.toContain("untracked content is not printed");
    expect(diff).not.toContain("ignored.txt");
  } finally { await rm(root, { recursive: true, force: true }); }
});
