import path from "node:path";
import {
  mkdir,
  writeFile,
  lstat,
  readFile,
  copyFile,
  chmod,
} from "node:fs/promises";
import { homedir } from "node:os";
const root = path.resolve(import.meta.dir, ".."),
  label = "com.freecoda.recovery-backup",
  runtime = path.join(
    homedir(),
    "Library/Application Support/FreecodaRecovery",
  );
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
if (
  process.platform !== "darwin" ||
  process.argv.slice(2).join(" ") !== "--install"
)
  throw Error(
    "Usage on macOS: bun --env-file=PRIVATE_ENV scripts/recovery-install-schedule.ts --install",
  );
if (
  !process.env.DATABASE_URL ||
  !process.env.CLOUD_ENCRYPTION_KEY ||
  process.env.FREECODA_RECOVERY_CUSTODY_CONFIRMED !== "true" ||
  !process.env.FREECODA_DRIVE_CREDENTIAL_FILE ||
  !process.env.FREECODA_DRIVE_FOLDER_ID ||
  !process.env.FREECODA_RECOVERY_ARCHIVE_KEY_FILE
)
  throw Error("Verified private backup configuration required");
for (const name of [
  "scripts",
  "apps/web/node_modules/pg",
  ".data/recovery-drive",
  ".data/recovery-master",
])
  await mkdir(path.join(runtime, name), { recursive: true, mode: 0o700 });
for (const [source, destination] of [
  [
    process.env.FREECODA_DRIVE_CREDENTIAL_FILE,
    ".data/recovery-drive/oauth.json",
  ],
  [
    process.env.FREECODA_RECOVERY_ARCHIVE_KEY_FILE,
    ".data/recovery-master/archive-key-v1.key",
  ],
]) {
  const s = await lstat(source);
  if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) !== 0)
    throw Error("Private regular credential/key files required");
  await copyFile(source, path.join(runtime, destination));
  await chmod(path.join(runtime, destination), 0o600);
}
// Bundle the audited runtime outside Documents: launchd must not require macOS protected-folder access.
for (const script of ["recovery-scheduled", "recovery-drill"]) {
  const built = await Bun.build({
    entrypoints: [path.join(root, "scripts", script + ".ts")],
    target: "bun",
    outdir: path.join(runtime, "scripts"),
    naming: script + ".ts",
  });
  if (!built.success) throw Error("Recovery runtime build failed");
}
const pg = await Bun.build({
  entrypoints: [Bun.resolveSync("pg", path.join(root, "apps/web"))],
  target: "bun",
  format: "cjs",
  outdir: path.join(runtime, "apps/web/node_modules/pg"),
  naming: "index.js",
});
if (!pg.success) throw Error("Recovery database client build failed");
await writeFile(
  path.join(runtime, "apps/web/package.json"),
  '{"type":"commonjs"}',
  { mode: 0o600 },
);
const values = {
  DATABASE_URL: process.env.DATABASE_URL,
  CLOUD_ENCRYPTION_KEY: process.env.CLOUD_ENCRYPTION_KEY,
  FREECODA_DRIVE_CREDENTIAL_FILE: path.join(
    runtime,
    ".data/recovery-drive/oauth.json",
  ),
  FREECODA_DRIVE_FOLDER_ID: process.env.FREECODA_DRIVE_FOLDER_ID,
  FREECODA_RECOVERY_ARCHIVE_KEY_FILE: path.join(
    runtime,
    ".data/recovery-master/archive-key-v1.key",
  ),
  FREECODA_RECOVERY_CUSTODY_CONFIRMED: "true",
};
await writeFile(
  path.join(runtime, ".data/recovery-drive/schedule.env"),
  Object.entries(values)
    .map(([k, v]) => k + "=" + JSON.stringify(v))
    .join("\n") + "\n",
  { mode: 0o600 },
);
const directory = path.join(homedir(), "Library/LaunchAgents"),
  filename = path.join(directory, label + ".plist"),
  logs = path.join(runtime, ".data/recovery-drive");
await mkdir(directory, { recursive: true, mode: 0o700 });
for (const name of ["schedule.stdout.log", "schedule.stderr.log"])
  await writeFile(path.join(logs, name), "", { mode: 0o600, flag: "a" });
const args = [
  process.execPath,
  "--env-file=" + path.join(runtime, ".data/recovery-drive/schedule.env"),
  path.join(runtime, "scripts/recovery-scheduled.ts"),
];
const xml = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map((a) => "<string>" + escape(a) + "</string>").join("")}</array><key>WorkingDirectory</key><string>${escape(runtime)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict><key>StartCalendarInterval</key><dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>15</integer></dict><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>${escape(path.join(logs, "schedule.stdout.log"))}</string><key>StandardErrorPath</key><string>${escape(path.join(logs, "schedule.stderr.log"))}</string></dict></plist>`;
await writeFile(filename, xml, { mode: 0o600 });
if (
  (await Bun.spawn(["/usr/bin/plutil", "-lint", filename], {
    stdout: "ignore",
    stderr: "ignore",
  }).exited) !== 0
)
  throw Error("Invalid schedule configuration");
const domain = `gui/${process.getuid!()}`;
await Bun.spawn(["/bin/launchctl", "bootout", domain + "/" + label], {
  stdout: "ignore",
  stderr: "ignore",
}).exited;
if (
  (await Bun.spawn(["/bin/launchctl", "bootstrap", domain, filename], {
    stdout: "ignore",
    stderr: "ignore",
  }).exited) !== 0
)
  throw Error("Schedule registration failed");
if (
  (await Bun.spawn(["/bin/launchctl", "print", domain + "/" + label], {
    stdout: "ignore",
    stderr: "ignore",
  }).exited) !== 0
)
  throw Error("Schedule registration verification failed");
console.log(
  JSON.stringify({
    installed: true,
    label,
    dailyLocalTime: "04:15",
    runAtLoad: false,
    isolatedRuntime: true,
  }),
);
