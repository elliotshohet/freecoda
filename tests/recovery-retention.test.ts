import { test, expect } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { expireRecoveryArtifacts } from "../scripts/recovery-retention";
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-retention-"));
  const archiveDirectory = path.join(root, "archives"),
    keyDirectory = path.join(root, "keys");
  await mkdir(archiveDirectory);
  await mkdir(keyDirectory);
  return { root, archiveDirectory, keyDirectory };
}
async function pair(
  f: Awaited<ReturnType<typeof fixture>>,
  suffix: string,
  completed: string,
) {
  const base = `freecoda_restore_20261017000000000_${suffix}`;
  const bytes = Buffer.alloc(60, 42);
  const manifest = {
    status: "verified",
    completedAt: completed,
    retentionExpiresAt: new Date(
      Date.parse(completed) + 7 * 24 * 60 * 60_000,
    ).toISOString(),
    temporaryDatabaseDropped: true,
    encryptedBackup: `${base}.dump.aesgcm`,
    keyFile: `../keys/${base}.key`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    encryptedBytes: bytes.length,
  };
  await writeFile(
    path.join(f.archiveDirectory, manifest.encryptedBackup),
    bytes,
  );
  await writeFile(path.join(f.keyDirectory, `${base}.key`), Buffer.alloc(32));
  await writeFile(
    path.join(f.archiveDirectory, `${base}.json`),
    JSON.stringify(manifest),
  );
  return { base, manifest };
}
test("recovery retention defaults to dry-run and applies only verified expired artifact pairs", async () => {
  const f = await fixture();
  try {
    const expired = await pair(f, "1111111111", "2026-10-01T00:00:00Z");
    const current = await pair(f, "2222222222", "2026-10-16T00:00:00Z");
    const now = new Date("2026-10-17T00:00:00Z");
    expect(await expireRecoveryArtifacts({ ...f, now })).toEqual({
      mode: "dry-run",
      expired: 1,
      deleted: 0,
      retained: 1,
      rejected: 0,
    });
    expect(
      (await stat(path.join(f.keyDirectory, `${expired.base}.key`))).size,
    ).toBe(32);
    expect(await expireRecoveryArtifacts({ ...f, now, apply: true })).toEqual({
      mode: "apply",
      expired: 1,
      deleted: 1,
      retained: 1,
      rejected: 0,
    });
    await expect(
      stat(path.join(f.archiveDirectory, `${expired.base}.json`)),
    ).rejects.toThrow();
    expect(
      (await stat(path.join(f.keyDirectory, `${current.base}.key`))).size,
    ).toBe(32);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test("recovery retention refuses malformed manifests, traversal, mismatched digest and directory overlap", async () => {
  const f = await fixture();
  try {
    const a = await pair(f, "3333333333", "2026-10-01T00:00:00Z");
    a.manifest.keyFile = "../../outside.key";
    await writeFile(
      path.join(f.archiveDirectory, `${a.base}.json`),
      JSON.stringify(a.manifest),
    );
    const b = await pair(f, "4444444444", "2026-10-01T00:00:00Z");
    await writeFile(
      path.join(f.archiveDirectory, b.manifest.encryptedBackup),
      Buffer.alloc(60, 43),
    );
    const invalidExpiry = await pair(f, "6666666666", "2026-10-01T00:00:00Z");
    invalidExpiry.manifest.retentionExpiresAt = "2026-10-02T00:00:00Z";
    await writeFile(
      path.join(f.archiveDirectory, `${invalidExpiry.base}.json`),
      JSON.stringify(invalidExpiry.manifest),
    );
    await writeFile(path.join(f.archiveDirectory, "arbitrary.json"), "{}");
    const result = await expireRecoveryArtifacts({
      ...f,
      now: new Date("2026-10-17T00:00:00Z"),
      apply: true,
    });
    expect(result.deleted).toBe(0);
    expect(result.rejected).toBe(4);
    expect(
      (await readFile(path.join(f.keyDirectory, `${a.base}.key`))).length,
    ).toBe(32);
    await expect(
      expireRecoveryArtifacts({ ...f, keyDirectory: f.archiveDirectory }),
    ).rejects.toThrow("separate");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test.skipIf(process.platform === "win32")(
  "recovery retention refuses symlink files and directories without deleting their targets",
  async () => {
    const f = await fixture();
    try {
      const a = await pair(f, "5555555555", "2026-10-01T00:00:00Z");
      const target = path.join(f.root, "unrelated-key");
      await writeFile(target, Buffer.alloc(32, 9));
      await rm(path.join(f.keyDirectory, `${a.base}.key`));
      await symlink(target, path.join(f.keyDirectory, `${a.base}.key`));
      expect(
        (
          await expireRecoveryArtifacts({
            ...f,
            now: new Date("2026-10-17T00:00:00Z"),
            apply: true,
          })
        ).rejected,
      ).toBe(1);
      expect((await readFile(target))[0]).toBe(9);
      const linked = path.join(f.root, "linked");
      await symlink(f.archiveDirectory, linked);
      await expect(
        expireRecoveryArtifacts({ ...f, archiveDirectory: linked }),
      ).rejects.toThrow("real directories");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);
