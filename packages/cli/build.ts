import { mkdir, writeFile, copyFile, chmod } from "node:fs/promises";
const root = new URL("./", import.meta.url);
await mkdir(new URL("dist/", root), { recursive: true });
const build = await Bun.build({
  entrypoints: [new URL("src/index.ts", root).pathname],
  outdir: new URL("dist/", root).pathname,
  target: "node",
  format: "esm",
  minify: false,
  sourcemap: "external",
});
if (!build.success) {
  console.error(build.logs);
  process.exit(1);
}
await mkdir(new URL("bin/", root), { recursive: true });
await writeFile(
  new URL("bin/freecoda.js", root),
  '#!/usr/bin/env node\nimport "../dist/index.js";\n',
  { mode: 0o755 },
);
for (const name of ["LICENSE", "NOTICE"])
  await copyFile(new URL("../../" + name, root), new URL(name, root));
await chmod(new URL("dist/index.js", root), 0o755);
console.log("Built packages/cli/dist/index.js and npm launcher.");
