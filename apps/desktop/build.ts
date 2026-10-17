import { mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";
const root = import.meta.dir;
const out = path.join(root, "dist");
await mkdir(out, { recursive: true });
for (const [entry, target, format] of [
  ["src/main.ts", "node", "cjs"],
  ["src/preload.ts", "node", "cjs"],
  ["src/renderer/index.ts", "browser", "esm"],
  ["src/renderer/theme.ts", "browser", "esm"],
] as const) {
  const result = await Bun.build({
    entrypoints: [path.join(root, entry)], outdir: out,
    naming: entry.endsWith("theme.ts") ? "theme.js" : entry.includes("renderer") ? "renderer.js" : "[name].cjs",
    target, format, external: ["electron"], minify: false, sourcemap: "external",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) throw new AggregateError(result.logs, `Failed to build ${entry}`);
}
await cp(path.join(root, "src/renderer/index.html"), path.join(out, "index.html"));
await cp(path.join(root, "src/renderer/styles.css"), path.join(out, "styles.css"));
await cp(path.join(root, "../../apps/web/public/brand/freecoda-mark.png"), path.join(out, "icon.png"));
await cp(path.join(root, "src/renderer/logo.svg"), path.join(out, "logo.svg"));
for (const name of ["LICENSE", "NOTICE"]) {
  await cp(path.join(root, "../..", name), path.join(out, name));
}
await writeFile(path.join(out, "build.json"), JSON.stringify({ version: (await Bun.file(path.join(root, "package.json")).json()).version }));
console.log("Desktop main, isolated preload, and renderer built.");
