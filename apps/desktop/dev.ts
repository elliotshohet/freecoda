import { spawn } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const root = import.meta.dir;
const devRoot = path.join(root, ".dev");
const out = path.join(devRoot, "dist");
const reloadFile = path.join(devRoot, "reload.json");
const manifest = await Bun.file(path.join(root, "package.json")).json();
await mkdir(out, { recursive: true });
await writeFile(path.join(devRoot, "package.json"), JSON.stringify({
  name: manifest.name,
  productName: "Freecoda",
  version: manifest.version,
  main: "dist/main.cjs",
}));

async function transform(kind: "renderer" | "main") {
  const entries = kind === "main"
    ? ["src/main.ts", "src/preload.ts", "src/renderer/index.ts", "src/renderer/theme.ts"]
    : ["src/renderer/index.ts", "src/renderer/theme.ts"];
  for (const entry of entries) {
    const renderer = entry.includes("renderer/");
    const result = await Bun.build({
      entrypoints: [path.join(root, entry)],
      outdir: out,
      naming: entry.endsWith("theme.ts") ? "theme.js" : renderer ? "renderer.js" : "[name].cjs",
      target: renderer ? "browser" : "node",
      format: renderer ? "esm" : "cjs",
      external: ["electron"],
      minify: false,
      sourcemap: "external",
      define: { "process.env.NODE_ENV": JSON.stringify("development") },
    });
    if (!result.success) throw new AggregateError(result.logs, `Could not transform ${entry}`);
  }
  for (const name of ["index.html", "styles.css", "logo.svg"]) {
    await cp(path.join(root, "src/renderer", name), path.join(out, name));
  }
  await cp(path.join(root, "../web/public/brand/freecoda-mark.png"), path.join(out, "icon.png"));
  for (const name of ["LICENSE", "NOTICE"]) await cp(path.join(root, "../..", name), path.join(out, name));
  await writeFile(path.join(out, "build.json"), JSON.stringify({ version: manifest.version }));
}

let pending: "renderer" | "main" | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let transforming = false;
let revision = Date.now();
let stopping = false;
const watchers: FSWatcher[] = [];
async function refresh() {
  if (transforming || stopping || !pending) return;
  const kind = pending;
  pending = undefined;
  transforming = true;
  try {
    await transform(kind);
    await writeFile(reloadFile, JSON.stringify({ kind, revision: ++revision }));
    console.log(`[desktop:dev] ${kind === "main" ? "App restart" : "Renderer reload"} ready.`);
  } catch (error) {
    console.error("[desktop:dev] Source transform failed; fix the source to retry.", error);
  } finally {
    transforming = false;
    if (pending) void refresh();
  }
}
function changed(kind: "renderer" | "main") {
  if (stopping) return;
  if (pending !== "main") pending = kind;
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), 180);
}
for (const directory of [path.join(root, "src"), path.join(root, "../../packages/core/src"), path.join(root, "../../packages/contracts/src")]) {
  watchers.push(watch(directory, { recursive: true }, (_event, filename) => {
    changed(directory === path.join(root, "src") && filename?.toString().replaceAll("\\", "/").startsWith("renderer/") ? "renderer" : "main");
  }));
}
watchers.push(watch(path.join(root, "../web/public/brand"), () => changed("renderer")));
transforming = true;
try {
  await transform("main");
} catch (error) {
  for (const watcher of watchers) watcher.close();
  throw error;
}
await writeFile(reloadFile, JSON.stringify({ kind: "main", revision }));
transforming = false;
const require = createRequire(path.join(root, "package.json"));
const electron = require("electron") as string;
const extraArgs = process.argv.slice(2);
const hasProfile = extraArgs.some(argument => argument === "--user-data-dir" || argument.startsWith("--user-data-dir="));
const launchArgs = [devRoot, ...(!hasProfile ? [`--user-data-dir=${path.join(devRoot, "user-data")}`] : []), ...extraArgs];
const child = spawn(electron, launchArgs, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "development", FREECODA_DESKTOP_DEV: "1", FREECODA_DESKTOP_DEV_RELOAD_FILE: reloadFile },
});
child.on("error", error => { console.error("[desktop:dev] Electron could not start:", error); stop(1); });
child.on("exit", (code, signal) => {
  if (!stopping) console.log(`[desktop:dev] Electron process exited (${signal ?? code}); watching source for the relaunched app. Ctrl+C stops watching.`);
});
function stop(code = 0) {
  stopping = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  process.exit(code);
}
if (pending) void refresh();
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
console.log("[desktop:dev] Electron running from source with an isolated development profile; watching desktop, core, and contracts. Ctrl+C stops watching.");
