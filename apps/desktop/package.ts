import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const args = process.argv.slice(2).filter((value) => value !== "--");
const result = Bun.spawn(["node", require.resolve("electron-builder/cli.js"), ...args, "--publish", "never"], {
  cwd: import.meta.dir, stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
process.exitCode = await result.exited;
