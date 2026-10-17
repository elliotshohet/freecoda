import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runShell } from "../packages/core/src/shell";
test("native shell executes approved commands, preserves exit codes, and strips secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-shell-"));
  const previous = process.env.FREECODA_PLATFORM_TEST_SECRET;
  process.env.FREECODA_PLATFORM_TEST_SECRET = "private-fixture-value";
  try {
    const result = await runShell(
      "node -e \"process.stdout.write(process.env.FREECODA_PLATFORM_TEST_SECRET || 'safe-output'); process.exit(7)\"",
      root,
      async () => true,
    );
    expect(result.output).toBe("safe-output");
    expect(result.exitCode).toBe(7);
    const controller = new AbortController();
    const start = Date.now();
    const timer = setTimeout(() => controller.abort(), 500);
    const pending = await runShell(
      'node -e "setTimeout(() => {}, 30000)"',
      root,
      async () => true,
      controller.signal,
    );
    clearTimeout(timer);
    expect(Date.now() - start).toBeLessThan(10000);
    expect(pending.exitCode).not.toBe(0);
  } finally {
    if (previous === undefined)
      delete process.env.FREECODA_PLATFORM_TEST_SECRET;
    else process.env.FREECODA_PLATFORM_TEST_SECRET = previous;
    await rm(root, { recursive: true, force: true });
  }
}, 15000);

test.skipIf(process.platform === "win32")(
  "POSIX cancellation finishes hard kill after the shell closes redirected pipes",
  async () => {
    const { readFile, writeFile } = await import("node:fs/promises");
    const root = await mkdtemp(path.join(tmpdir(), "freecoda-shell-tree-"));
    const controller = new AbortController();
    const script = path.join(root, "child.cjs");
    const pidFile = path.join(root, "child.pid");
    let pid: number | undefined;
    try {
      await writeFile(
        script,
        `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`,
      );
      const quote = (value: string) =>
        "'" + value.replaceAll("'", "'\\''") + "'";
      // The shell dies on TERM; its child owns no output pipes and ignores TERM.
      const pending = runShell(
        `${quote(process.execPath)} ${quote(script)} >/dev/null 2>&1 & wait`,
        root,
        async () => true,
        controller.signal,
      );
      for (let i = 0; i < 500; i++) {
        try {
          pid = Number(await readFile(pidFile, "utf8"));
          break;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(pid).toBeGreaterThan(0);
      controller.abort();
      await pending;
      if (process.platform === "linux") {
        // Minimal container init may retain an already-dead adopted child as a
        // zombie. It cannot execute, even though kill(pid, 0) still finds it.
        let dead = false;
        try {
          dead = /^State:\s+Z/m.test(
            await readFile(`/proc/${pid}/status`, "utf8"),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") dead = true;
          else throw error;
        }
        expect(dead).toBe(true);
      } else {
        expect(() => process.kill(pid!, 0)).toThrow();
      }
    } finally {
      controller.abort();
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      await rm(root, { recursive: true, force: true });
    }
  },
  10000,
);
