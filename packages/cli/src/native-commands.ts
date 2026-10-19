import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ModelMessage } from "ai";

const execute = promisify(execFile);

export function latestAssistantText(messages: ModelMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== "assistant") continue;
    const text = typeof message.content === "string" ? message.content : message.content.filter(part => part.type === "text").map(part => part.type === "text" ? part.text : "").join("");
    if (text) return text;
  }
  return null;
}

export async function copyAssistantText(text: string): Promise<void> {
  if (process.platform !== "darwin") throw Error("Clipboard copying is supported on macOS in this CLI. Select the response in your terminal to copy it on this platform.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/pbcopy", [], { stdio: ["pipe", "ignore", "ignore"], timeout: 5000 });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(Error("The system clipboard is unavailable. Select the response in your terminal to copy it.")));
    child.stdin.end(text);
  });
}

/** Caller must enforce coding mode and explicit repository trust first. */
export async function workspaceDiff(root: string): Promise<string> {
  const run = async (args: string[]) => (await execute("git", ["--no-pager", ...args], { cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" } })).stdout.trim();
  const [staged, unstaged, untracked] = await Promise.all([
    run(["diff", "--no-ext-diff", "--no-textconv", "--cached", "--"]),
    run(["diff", "--no-ext-diff", "--no-textconv", "--"]),
    run(["ls-files", "--others", "--exclude-standard"]),
  ]);
  return [staged && `Staged changes\n${staged}`, unstaged && `Unstaged changes\n${unstaged}`, untracked && `Untracked files (paths only)\n${untracked}`].filter(Boolean).join("\n\n") || "No staged, unstaged, or untracked changes.";
}
