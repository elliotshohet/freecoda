import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";

export const CLI_VERSION = "0.1.0";
const REGISTRY = "https://registry.npmjs.org/freecoda/latest";
export function validVersion(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value);
}
export function newerVersion(latest: string, current = CLI_VERSION): boolean {
  if (!validVersion(latest) || !validVersion(current)) return false;
  const a = latest.split(".").map(Number), b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function installCommand(version: string): string {
  if (!validVersion(version)) throw new Error("Invalid package version.");
  return `npm install --global freecoda@${version} --registry=https://registry.npmjs.org --ignore-scripts`;
}
export async function checkUpdate(fetcher: (input: string, init: RequestInit) => Promise<Response> = fetch): Promise<string> {
  const response = await fetcher(REGISTRY, {
    redirect: "error", signal: AbortSignal.timeout(2500),
    headers: { Accept: "application/json" },
  });
  if (!response.ok || !response.body) throw new Error("Could not check npm for updates.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) throw new Error("npm returned an oversized update response.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (result.name !== "freecoda" || !validVersion(result.version))
    throw new Error("npm returned invalid Freecoda package metadata.");
  return result.version;
}
export async function installUpdate(version: string): Promise<void> {
  installCommand(version); // Validate before constructing arguments or launching anything.
  const args = ["install", "--global", `freecoda@${version}`, "--registry=https://registry.npmjs.org", "--ignore-scripts"];
  // Launch npm's known CLI with Node when available, avoiding cmd.exe/shell quoting on Windows.
  const nodeDirectory = dirname(process.execPath);
  const candidates = [join(nodeDirectory, "node_modules/npm/bin/npm-cli.js"), join(nodeDirectory, "../lib/node_modules/npm/bin/npm-cli.js")];
  let npmScript: string | undefined;
  for (const path of candidates) { try { await access(path); npmScript = path; break; } catch {} }
  if (!npmScript && process.platform === "win32")
    throw new Error(`Could not locate npm beside Node. Run this in your terminal: ${installCommand(version)}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmScript ? process.execPath : "npm", npmScript ? [npmScript, ...args] : args, {
      shell: false, stdio: "inherit", cwd: nodeDirectory,
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`npm update failed (${code ?? "interrupted"}). Check your npm global directory permissions; no sudo was attempted.`)));
  });
}
