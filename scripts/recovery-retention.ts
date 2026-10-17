import { lstat, readdir, readFile, unlink, realpath } from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
const namePattern = /^freecoda_restore_\d{17}_[a-f0-9]{10}$/;
const within = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative))
  );
};
async function regular(filename: string, limit?: number) {
  const info = await lstat(filename);
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    (limit !== undefined && info.size > limit)
  )
    throw new Error("Invalid recovery artifact");
  return info;
}
export async function expireRecoveryArtifacts(options: {
  archiveDirectory: string;
  keyDirectory: string;
  apply?: boolean;
  now?: Date;
}) {
  const archiveDirectory = path.resolve(options.archiveDirectory),
    keyDirectory = path.resolve(options.keyDirectory);
  for (const directory of [archiveDirectory, keyDirectory]) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Recovery directories must be real directories");
  }
  const archive = await realpath(archiveDirectory),
    keys = await realpath(keyDirectory);
  if (within(archive, keys) || within(keys, archive))
    throw new Error("Archive and key directories must be separate");
  const now = (options.now || new Date()).getTime();
  if (!Number.isFinite(now)) throw new Error("Invalid retention time");
  const result = {
    mode: options.apply ? "apply" : "dry-run",
    expired: 0,
    deleted: 0,
    retained: 0,
    rejected: 0,
  };
  for (const name of await readdir(archive)) {
    if (!name.endsWith(".json")) continue;
    const base = name.slice(0, -5);
    if (!namePattern.test(base)) {
      result.rejected++;
      continue;
    }
    try {
      const manifestPath = path.join(archive, name);
      await regular(manifestPath, 100_000);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const backupPath = path.join(archive, `${base}.dump.aesgcm`),
        keyPath = path.join(keys, `${base}.key`);
      const recordedKey =
        typeof manifest.keyFile === "string"
          ? path.resolve(archive, manifest.keyFile)
          : "";
      const completed = Date.parse(manifest.completedAt),
        expiry = Date.parse(manifest.retentionExpiresAt);
      if (
        manifest.status !== "verified" ||
        manifest.temporaryDatabaseDropped !== true ||
        manifest.encryptedBackup !== `${base}.dump.aesgcm` ||
        recordedKey !== keyPath ||
        !Number.isFinite(completed) ||
        !Number.isFinite(expiry) ||
        Math.abs(expiry - completed - 7 * 24 * 60 * 60_000) > 1000 ||
        !/^[a-f0-9]{64}$/.test(manifest.sha256)
      )
        throw new Error("Invalid manifest");
      const backup = await regular(backupPath),
        key = await regular(keyPath);
      if (
        key.size !== 32 ||
        backup.size < 44 ||
        manifest.encryptedBytes !== backup.size
      )
        throw new Error("Invalid artifact pair");
      if (expiry > now) {
        result.retained++;
        continue;
      }
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(backupPath))
        hash.update(chunk);
      if (hash.digest("hex") !== manifest.sha256)
        throw new Error("Artifact digest mismatch");
      result.expired++;
      if (options.apply) {
        // Recheck each entry immediately before unlink. unlink never follows a
        // replaced symlink; validated flat paths cannot traverse directories.
        await regular(backupPath);
        await regular(keyPath);
        await regular(manifestPath, 100_000);
        await unlink(backupPath);
        await unlink(keyPath);
        await unlink(manifestPath);
        result.deleted++;
      }
    } catch {
      result.rejected++;
    }
  }
  return result;
}
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !["--apply", "--dry-run"].includes(arg)) ||
    (args.includes("--apply") && args.includes("--dry-run"))
  ) {
    console.error(
      "Usage: bun scripts/recovery-retention.ts [--dry-run | --apply]",
    );
    process.exitCode = 1;
  } else {
    const root = path.resolve(import.meta.dir, "..");
    try {
      console.log(
        JSON.stringify(
          await expireRecoveryArtifacts({
            archiveDirectory: path.join(root, ".data/recovery"),
            keyDirectory: path.resolve(
              process.env.FREECODA_RECOVERY_KEY_DIRECTORY ||
                path.join(root, ".data/recovery-keys"),
            ),
            apply: args.includes("--apply"),
          }),
        ),
      );
    } catch {
      console.error(
        "Recovery retention refused invalid or unavailable artifact directories.",
      );
      process.exitCode = 1;
    }
  }
}
