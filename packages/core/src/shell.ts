import { spawn } from "node:child_process";
import path from "node:path";
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
        "SystemRoot",
        "COMSPEC",
        "ComSpec",
        "PATHEXT",
        "USERPROFILE",
        "TEMP",
        "TMP",
      ])
        if (process.env[key]) env[key] = process.env[key];
      env.CI = "1";
      const windows = process.platform === "win32";
      const shell = windows
        ? process.env.ComSpec || process.env.COMSPEC || "cmd.exe"
        : "/bin/sh";
      // Match Node's cmd.exe shell mode: cmd parses the outer quotes itself,
      // rather than receiving CRT-style backslash escaping of embedded quotes.
      const args = windows
        ? ["/d", "/s", "/c", `"${command}"`]
        : ["-c", command];
      const child = spawn(shell, args, {
        cwd: root,
        env,
        detached: !windows,
        windowsHide: true,
        windowsVerbatimArguments: windows,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let timedOut = false;
      let termination: Promise<void> | undefined;
      const kill = () => {
        if (termination) return;
        if (windows) {
          termination = new Promise<void>((done) => {
            if (!child.pid) {
              done();
              return;
            }
            const killer = spawn(
              path.win32.join(
                process.env.SystemRoot ||
                  process.env.SYSTEMROOT ||
                  "C:\\Windows",
                "System32",
                "taskkill.exe",
              ),
              ["/pid", String(child.pid), "/T", "/F"],
              { windowsHide: true, stdio: "ignore" },
            );
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              clearTimeout(deadline);
              done();
            };
            const fallback = () => {
              child.kill();
              finish();
            };
            const deadline = setTimeout(() => {
              killer.kill();
              fallback();
            }, 5000);
            killer.once("error", fallback);
            killer.once("close", (code) => {
              if (code !== 0) child.kill();
              finish();
            });
          });
          return;
        }
        // Keep this promise and timer alive even if the shell exits first.
        // Redirected descendants can close every inherited pipe while still
        // ignoring TERM; resolving on shell close would let Electron quit
        // before the process-group hard kill happens.
        termination = new Promise<void>((done) => {
          try {
            process.kill(-child.pid!, "SIGTERM");
          } catch {}
          setTimeout(() => {
            try {
              process.kill(-child.pid!, "SIGKILL");
            } catch {}
            // Give the OS time to reap the terminated group before a caller
            // tears down the application. Bound this for init systems that
            // retain zombie process entries.
            const deadline = Date.now() + 1000;
            const reap = () => {
              try {
                process.kill(-child.pid!, 0);
              } catch {
                done();
                return;
              }
              if (Date.now() >= deadline) {
                done();
                return;
              }
              setTimeout(reap, 10);
            };
            reap();
          }, 1000);
        });
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
      child.on("close", async (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        await termination;
        resolve({
          output:
            redactSecrets(output) + (timedOut ? "\nCommand timed out." : ""),
          exitCode: code,
        });
      });
    },
  );
}
