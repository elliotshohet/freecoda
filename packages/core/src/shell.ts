import { spawn } from "node:child_process";
import { redactSecrets, type Approval } from "./workspace";
export async function runShell(
  command: string,
  root: string,
  approve: Approval,
  signal?: AbortSignal,
) {
  if (!command || command.length > 4000)
    throw new Error("Command must be 1–4000 characters.");
  if (
    !(await approve(
      "shell",
      `${command}\n\nRuns as your user in ${root}. This is not an OS sandbox.`,
    ))
  )
    return {
      output: "User declined. Do not retry this command.",
      exitCode: null,
    };
  signal?.throwIfAborted();
  return new Promise<{ output: string; exitCode: number | null }>(
    (resolve, reject) => {
      const env: NodeJS.ProcessEnv = {};
      for (const key of [
        "PATH",
        "HOME",
        "USER",
        "TMPDIR",
        "LANG",
        "SHELL",
        "TERM",
        "SYSTEMROOT",
      ])
        if (process.env[key]) env[key] = process.env[key];
      env.CI = "1";
      const child = spawn("/bin/sh", ["-c", command], {
        cwd: root,
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let timedOut = false;
      const kill = () => {
        try {
          process.kill(-child.pid!, "SIGTERM");
        } catch {}
        const hard = setTimeout(() => {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {}
        }, 1000);
        hard.unref();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, 60_000);
      const abort = () => kill();
      signal?.addEventListener("abort", abort, { once: true });
      for (const stream of [child.stdout, child.stderr])
        stream.on("data", (chunk) => {
          if (output.length < 24000)
            output += chunk.toString().slice(0, 24000 - output.length);
        });
      child.on("error", (e) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve({
          output:
            redactSecrets(output) + (timedOut ? "\nCommand timed out." : ""),
          exitCode: code,
        });
      });
    },
  );
}
