import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, basename, resolve } from "node:path";

import { CLI_VERSION } from "./version";
export { CLI_VERSION } from "./version";
const RELEASES = "https://api.github.com/repos/elliotshohet/freecoda/releases?per_page=100";
const DOWNLOADS = "https://github.com/elliotshohet/freecoda/releases/download";
export function validVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value)
  );
}
export function newerVersion(latest: string, current = CLI_VERSION): boolean {
  if (!validVersion(latest) || !validVersion(current)) return false;
  const a = latest.split(".").map(Number),
    b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function installCommand(version: string): string {
  if (!validVersion(version)) throw new Error("Invalid package version.");
  return `freecoda update --install`;
}
async function boundedFetch(url: string, maximum: number, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: "application/json" },
    // GitHub release downloads redirect to its asset CDN. No credentials are attached.
    redirect: "follow",
  });
  if (!response.ok || !response.body) throw new Error("Could not download the Freecoda update.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) throw new Error("Oversized Freecoda update response.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
export async function checkUpdate(fetcher: typeof fetch = fetch): Promise<string> {
  const releases = JSON.parse((await boundedFetch(RELEASES, 2 * 1024 * 1024, fetcher)).toString("utf8"));
  if (!Array.isArray(releases)) throw new Error("Invalid Freecoda release metadata.");
  const versions = releases.filter((r) => !r.draft && !r.prerelease && typeof r.tag_name === "string")
    .map((r) => r.tag_name.startsWith("cli-v") ? r.tag_name.slice(5) : "")
    .filter(validVersion).sort((a, b) => newerVersion(a, b) ? -1 : newerVersion(b, a) ? 1 : 0);
  if (!versions.length) throw new Error("No stable Freecoda CLI release is available.");
  return versions[0];
}
/** Refuse source checkouts, project-local installs and ambiguous/global root locations. */
export async function installationPrefix(entry = process.argv[1]): Promise<string> {
  const bin = await realpath(entry);
  const root = dirname(dirname(bin));
  if (basename(root) !== "freecoda" || basename(dirname(root)) !== "node_modules" || basename(bin) !== "freecoda.js")
    throw new Error("Automatic updates apply to global npm installations; source checkouts stay unchanged.");
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (pkg.name !== "freecoda" || pkg.bin?.freecoda !== "bin/freecoda.js") throw new Error("Unrecognized Freecoda installation.");
  const parent = dirname(dirname(root));
  const prefix = process.platform === "win32" ? parent : basename(parent) === "lib" ? dirname(parent) : undefined;
  if (!prefix) throw new Error("Unrecognized global installation prefix; update manually.");
  if (process.platform === "win32") {
    const allowed = [process.env.npm_config_prefix, process.env.APPDATA ? join(process.env.APPDATA, "npm") : undefined, dirname(process.execPath)].filter((value): value is string => !!value);
    if (!allowed.some((value) => resolve(value).toLowerCase() === resolve(prefix).toLowerCase()))
      throw new Error("Project-local installations are not updated automatically.");
  }
  await access(root, 2);
  return prefix;
}
export async function downloadUpdate(version: string, directory: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!validVersion(version)) throw new Error("Invalid package version.");
  const name = `freecoda-${version}.tgz`;
  const base = `${DOWNLOADS}/cli-v${version}`;
  const checksums = (await boundedFetch(`${base}/SHA256SUMS.txt`, 16384, fetcher)).toString("utf8");
  const expected = checksums.split(/\r?\n/).map((line) => /^([a-f0-9]{64})\s+\*?([^\s]+)$/.exec(line)).find((match) => match?.[2] === name)?.[1];
  if (!expected) throw new Error("Release checksum is missing or invalid.");
  const archive = await boundedFetch(`${base}/${name}`, 32 * 1024 * 1024, fetcher);
  if (createHash("sha256").update(archive).digest("hex") !== expected) throw new Error("Release checksum mismatch; nothing was installed.");
  const file = join(directory, name);
  await writeFile(file, archive, { mode: 0o600 });
  return file;
}
export async function installUpdate(version: string, options: { entry?: string; fetcher?: typeof fetch } = {}): Promise<void> {
  installCommand(version);
  const prefix = await installationPrefix(options.entry);
  const directory = await mkdtemp(join(tmpdir(), "freecoda-update-"));
  try {
    const archive = await downloadUpdate(version, directory, options.fetcher);
    const args = [
      "install",
      "--global",
      archive,
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--update-notifier=false",
    ];
    // Launch npm's known CLI with Node when available, avoiding cmd.exe/shell quoting on Windows.
    const nodeDirectory = dirname(process.execPath);
    const candidates = [
      join(nodeDirectory, "node_modules/npm/bin/npm-cli.js"),
      join(nodeDirectory, "../lib/node_modules/npm/bin/npm-cli.js"),
    ];
    let npmScript: string | undefined;
    for (const path of candidates) {
      try {
        await access(path);
        npmScript = path;
        break;
      } catch {}
    }
    if (!npmScript && process.platform === "win32")
      throw new Error(
        `Could not locate npm beside Node. Run this in your terminal: ${installCommand(version)}`,
      );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        npmScript ? process.execPath : "npm",
        npmScript ? [npmScript, ...args] : args,
        {
          shell: false,
          stdio: "inherit",
          cwd: nodeDirectory,
        },
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                `npm update failed (${code ?? "interrupted"}). Check your npm global directory permissions; no sudo was attempted.`,
              ),
            ),
      );
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Called only after an interactive session has finished, never during a turn. */
export async function automaticUpdate(notify: (message: string) => void, options: { entry?: string; fetcher?: typeof fetch } = {}): Promise<void> {
  if (process.env.FREECODA_AUTO_UPDATE === "0") return;
  try { await installationPrefix(options.entry); } catch { return; }
  try {
    const latest = await checkUpdate(options.fetcher);
    if (!newerVersion(latest)) return;
    notify(`Installing Freecoda ${latest} for your next session…`);
    await installUpdate(latest, options);
    notify(`Freecoda ${latest} is installed. Your next session will use it.`);
  } catch {
    notify("Automatic update was unavailable. Keep using Freecoda; run freecoda update --install to retry. No sudo or restart was attempted.");
  }
}
