import path from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { lstat, mkdir, open, readdir, writeFile } from "node:fs/promises";
import { privateJson, RecoveryDrive } from "./recovery-drive";
import { expireRecoveryArtifacts } from "./recovery-retention";
/** SQLite owns the process lock: crashes release it without stale-file deletion races. */
export async function acquireRecoveryLock(filename: string) {
  try {
    const fd = await open(filename, "wx", 0o600);
    await fd.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw Error("Recovery lock must be a private regular file");
  const database = new Database(filename);
  try {
    database.exec("PRAGMA busy_timeout=0");
    database.exec(
      "CREATE TABLE IF NOT EXISTS claim (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, token TEXT NOT NULL)",
    );
    database.exec("BEGIN EXCLUSIVE");
    database
      .query("INSERT OR REPLACE INTO claim(id,pid,token) VALUES(1,?,?)")
      .run(process.pid, randomUUID());
  } catch {
    database.close();
    throw Error("Recovery job is locked or its lock is unavailable");
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    // Rollback the transient claim; leave the database inode in place for other contenders.
    try {
      database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  };
}

export async function runScheduledRecovery(
  options: {
    root?: string;
    env?: NodeJS.ProcessEnv;
    authorize?: typeof RecoveryDrive.authorize;
    backup?: () => Promise<void>;
    expire?: typeof expireRecoveryArtifacts;
  } = {},
) {
  const root = options.root || path.resolve(import.meta.dir, ".."),
    env = options.env || process.env,
    directory = path.join(root, ".data/recovery"),
    lock = path.join(root, ".data/recovery-scheduled.lock"),
    status = path.join(root, ".data/recovery-scheduled-status.json");
  let release: (() => Promise<void>) | undefined;
  try {
    // Fail before export/compute when unattended authorization or master custody is absent.
    const credentialFile = env.FREECODA_DRIVE_CREDENTIAL_FILE,
      folder = env.FREECODA_DRIVE_FOLDER_ID;
    if (
      !credentialFile ||
      !folder ||
      !env.FREECODA_RECOVERY_ARCHIVE_KEY_FILE ||
      env.FREECODA_RECOVERY_CUSTODY_CONFIRMED !== "true"
    )
      throw Error("Unattended configuration incomplete");
    await mkdir(path.dirname(lock), { recursive: true, mode: 0o700 });
    release = await acquireRecoveryLock(lock);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const drive = await (options.authorize || RecoveryDrive.authorize)(
      await privateJson(credentialFile),
      folder,
    );
    await drive.assertPrivateFolder();
    // Expiry runs even when a later source export fails; only validated tagged files qualify.
    const remote = await drive.prune();
    if (remote.rejected) throw Error("Remote retention rejected artifacts");
    const before = new Set(await readdir(directory));
    if (options.backup) await options.backup();
    else {
      const child = Bun.spawn([process.execPath, "scripts/recovery-drill.ts"], {
        cwd: root,
        env,
        stdout: "ignore",
        stderr: "ignore",
      });
      if ((await child.exited) !== 0)
        throw Error("Logical backup verification failed");
    }
    const added = (await readdir(directory)).filter(
      (n) =>
        !before.has(n) &&
        /^freecoda_restore_\d{17}_[a-f0-9]{10}\.json$/.test(n),
    );
    if (added.length !== 1) throw Error("Ambiguous backup receipt");
    const filename = path.join(directory, added[0]),
      manifest = await privateJson(filename);
    const upload = await drive.upload(
      path.join(directory, manifest.encryptedBackup),
      manifest,
    );
    const local = await (options.expire || expireRecoveryArtifacts)({
      archiveDirectory: directory,
      keyDirectory: path.resolve(
        env.FREECODA_RECOVERY_KEY_DIRECTORY ||
          path.join(root, ".data/recovery-keys"),
      ),
      apply: true,
    });
    const receipt = {
      status: local.rejected ? "failed" : "verified",
      completedAt: new Date().toISOString(),
      ...upload,
      remoteDeleted: remote.deleted,
      localDeleted: local.deleted,
      localRejected: local.rejected,
    };
    await writeFile(status, JSON.stringify(receipt) + "\n", { mode: 0o600 });
    return receipt;
  } catch {
    if (release)
      await writeFile(
        status,
        JSON.stringify({
          status: "failed",
          completedAt: new Date().toISOString(),
        }) + "\n",
        { mode: 0o600 },
      );
    throw Error(
      "Scheduled recovery failed; inspect private status and operator configuration.",
    );
  } finally {
    if (release) await release();
  }
}

if (import.meta.main) {
  try {
    const result = await runScheduledRecovery();
    if (result.status !== "verified") process.exitCode = 1;
  } catch {
    console.error(
      "Scheduled recovery failed; inspect private status and operator configuration.",
    );
    process.exitCode = 1;
  }
}
