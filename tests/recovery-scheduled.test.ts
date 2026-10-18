import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  acquireRecoveryLock,
  runScheduledRecovery,
} from "../scripts/recovery-scheduled";

test("exclusive recovery claim rejects overlap and releases after process death", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-lock-test-"));
  const lock = path.join(root, "lock.sqlite");
  let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    const release = await acquireRecoveryLock(lock);
    await expect(acquireRecoveryLock(lock)).rejects.toThrow("locked");
    await release();
    const module = path.resolve("scripts/recovery-scheduled.ts");
    child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { acquireRecoveryLock } from ${JSON.stringify(module)}; await acquireRecoveryLock(${JSON.stringify(lock)}); console.log('claimed'); setInterval(()=>{},1000);`,
      ],
      { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    );
    const reader = child.stdout.getReader();
    const ready = await reader.read();
    expect(new TextDecoder().decode(ready.value)).toContain("claimed");
    await reader.cancel();
    await expect(acquireRecoveryLock(lock)).rejects.toThrow("locked");
    child.kill("SIGKILL");
    await child.exited;
    const recovered = await acquireRecoveryLock(lock);
    await recovered();
    expect((await stat(lock)).mode & 0o077).toBe(0);
  } finally {
    child?.kill();
    if (child) await child.exited;
    await rm(root, { recursive: true, force: true });
  }
}, 10_000);

test("fresh scheduled directory works and rejected retention records failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-scheduled-test-"));
  try {
    const credential = path.join(root, "credential.json");
    await writeFile(credential, "{}", { mode: 0o600 });
    let backups = 0;
    const drive = {
      async assertPrivateFolder() {},
      async prune() {
        return { deleted: 0, rejected: 0 };
      },
      async upload() {
        return { uploaded: 2, downloadVerified: 2 };
      },
    };
    const result = await runScheduledRecovery({
      root,
      env: {
        FREECODA_DRIVE_CREDENTIAL_FILE: credential,
        FREECODA_DRIVE_FOLDER_ID: "fixture_private_folder",
        FREECODA_RECOVERY_ARCHIVE_KEY_FILE: "fixture-master",
        FREECODA_RECOVERY_CUSTODY_CONFIRMED: "true",
      },
      authorize: (async () => drive) as any,
      backup: async () => {
        backups++;
        await writeFile(
          path.join(
            root,
            ".data/recovery/freecoda_restore_20261017231048395_688958a7d7.json",
          ),
          JSON.stringify({ encryptedBackup: "fixture.dump.aesgcm" }),
          { mode: 0o600 },
        );
      },
      expire: async () => ({
        mode: "apply",
        deleted: 0,
        rejected: 1,
        expired: 0,
        retained: 0,
      }),
    });
    expect(backups).toBe(1);
    expect(result.status).toBe("failed");
    const receipt = JSON.parse(
      await readFile(
        path.join(root, ".data/recovery-scheduled-status.json"),
        "utf8",
      ),
    );
    expect(receipt.status).toBe("failed");
    expect(receipt.localRejected).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing unattended custody fails before authorization or export", async () => {
  let calls = 0;
  await expect(
    runScheduledRecovery({
      env: {},
      authorize: (async () => {
        calls++;
      }) as any,
      backup: async () => {
        calls++;
      },
    }),
  ).rejects.toThrow("Scheduled recovery failed");
  expect(calls).toBe(0);
});
