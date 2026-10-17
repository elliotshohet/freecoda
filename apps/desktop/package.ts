import { createRequire } from "node:module";
import { packagingArguments } from "./src/package-options";
const require = createRequire(import.meta.url);
const args = packagingArguments(process.argv.slice(2));
const result = Bun.spawn(["node", require.resolve("electron-builder/cli.js"), ...args], {
  cwd: import.meta.dir, stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
process.exitCode = await result.exited;
