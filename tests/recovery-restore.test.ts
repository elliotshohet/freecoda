import { test, expect } from "bun:test";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
function fixture() {
  const key = randomBytes(32),
    iv = randomBytes(12),
    header = Buffer.from("FREECODA-PG-GCM1\n");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  const archive = Buffer.concat([
    header,
    iv,
    cipher.update(Buffer.from("PGDMP synthetic fixture")),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const manifest = {
    encryptedBytes: archive.length,
    sha256: createHash("sha256").update(archive).digest("hex"),
    schemaHash: "a".repeat(64),
    tableCount: 1,
    rowCounts: { fixture: "1" },
  };
  return { key, archive, manifest };
}
test("real restore entry rejects invalid key/tag/manifest before starting Docker", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { restoreArchive } = await import("../scripts/recovery-restore");
  const dir = await mkdtemp(tmpdir() + "/freecoda-preflight-");
  try {
    const f = fixture();
    const args = {
      archive: dir + "/archive",
      manifest: dir + "/manifest",
      key: dir + "/key",
      context: "nonexistent-context-must-never-execute",
    };
    await writeFile(args.archive, f.archive);
    await writeFile(args.manifest, JSON.stringify(f.manifest));
    await writeFile(args.key, randomBytes(32));
    await expect(restoreArchive(args)).rejects.toThrow("authentication");
    await writeFile(args.key, Buffer.alloc(8));
    await expect(restoreArchive(args)).rejects.toThrow("Invalid recovery key");
    await writeFile(args.key, f.key);
    f.archive[35]! ^= 1;
    f.manifest.sha256 = createHash("sha256").update(f.archive).digest("hex");
    await writeFile(args.archive, f.archive);
    await writeFile(args.manifest, JSON.stringify(f.manifest));
    await expect(restoreArchive(args)).rejects.toThrow("authentication");
    for (const patch of [
      { tableCount: 999 },
      { schemaHash: "invalid" },
      { encryptedBytes: 1 },
      { rowCounts: { fixture: "NaN" } },
    ]) {
      await writeFile(
        args.manifest,
        JSON.stringify({ ...f.manifest, ...patch }),
      );
      await expect(restoreArchive(args)).rejects.toThrow("manifest");
    }
    f.archive[0] = 0;
    f.manifest.sha256 = createHash("sha256").update(f.archive).digest("hex");
    await writeFile(args.archive, f.archive);
    await writeFile(args.manifest, JSON.stringify(f.manifest));
    await expect(restoreArchive(args)).rejects.toThrow("header");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
