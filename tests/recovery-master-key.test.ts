import { test, expect } from "bun:test";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
test("invalid retained master fails before database source or Docker initialization", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "freecoda-master-")),
    key = path.join(dir, "master.key");
  try {
    for (const fixture of [
      { bytes: 31, mode: 0o600 },
      { bytes: 32, mode: 0o644 },
    ]) {
      await writeFile(key, Buffer.alloc(fixture.bytes, 7));
      await chmod(key, fixture.mode);
      const p = Bun.spawn([process.execPath, "scripts/recovery-drill.ts"], {
        env: {
          ...process.env,
          DATABASE_URL: "not-a-database",
          FREECODA_RECOVERY_ARCHIVE_KEY_FILE: key,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const error = await new Response(p.stderr).text();
      await new Response(p.stdout).text();
      expect(await p.exited).toBe(1);
      expect(error).toContain("retained archive key validation");
      expect(error).not.toContain("not-a-database");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
