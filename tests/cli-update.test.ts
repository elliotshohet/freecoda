import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { checkUpdate, newerVersion, validVersion, downloadUpdate, installationPrefix, automaticUpdate } from "../packages/cli/src/update";

test("selects the newest stable CLI release, excluding desktop, drafts and prereleases", async () => {
  const fetcher = (async (url: string) => {
    expect(url).toBe("https://api.github.com/repos/elliotshohet/freecoda/releases?per_page=100");
    return Response.json([
      { tag_name: "v8.0.0" }, { tag_name: "cli-v0.2.1" }, { tag_name: "cli-v0.3.0", draft: true },
      { tag_name: "cli-v0.2.9", prerelease: true }, { tag_name: "cli-v0.1.9" },
    ]);
  }) as typeof fetch;
  expect(await checkUpdate(fetcher)).toBe("0.2.1");
  expect(newerVersion("0.10.0", "0.9.9")).toBe(true);
  expect(newerVersion("0.1.0", "0.2.0")).toBe(false);
  for (const value of ["--help", "1.0.0;evil", "01.0.0", "1.0.0\n"]) expect(validVersion(value)).toBe(false);
});

test("downloads exact canonical archive, verifies bytes before writing, refuses corrupt updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "freecoda-update-test-"));
  try {
    const archive = Buffer.from("actual fixture package bytes");
    const digest = createHash("sha256").update(archive).digest("hex");
    const fetcher = (async (url: string) => {
      expect(url.startsWith("https://github.com/elliotshohet/freecoda/releases/download/cli-v0.2.0/")).toBe(true);
      return new Response(url.endsWith("SHA256SUMS.txt") ? `${digest}  freecoda-0.2.0.tgz\n` : archive);
    }) as typeof fetch;
    const file = await downloadUpdate("0.2.0", directory, fetcher);
    expect(await readFile(file)).toEqual(archive);
    await expect(downloadUpdate("0.2.0", directory, (async (url: string) => new Response(url.endsWith("SHA256SUMS.txt") ? `${"0".repeat(64)}  freecoda-0.2.0.tgz` : archive)) as typeof fetch)).rejects.toThrow("checksum mismatch");
    await expect(downloadUpdate("--evil", directory, fetcher)).rejects.toThrow("Invalid");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("recognizes global installation and rejects source/project installations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "freecoda-prefix-test-"));
  try {
    const root = join(directory, "lib/node_modules/freecoda");
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(join(root, "bin/freecoda.js"), "");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "freecoda", bin: { freecoda: "bin/freecoda.js" } }));
    expect(await installationPrefix(join(root, "bin/freecoda.js"))).toBe(await realpath(directory));
    await mkdir(join(directory, "source/bin"), { recursive: true });
    await writeFile(join(directory, "source/bin/freecoda.js"), "");
    await expect(installationPrefix(join(directory, "source/bin/freecoda.js"))).rejects.toThrow("source checkouts");
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test.skipIf(process.platform === "win32")("installs verified release into the existing prefix with lifecycle scripts disabled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "freecoda-install-test-"));
  try {
    const root = join(directory, "lib/node_modules/freecoda");
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(join(root, "bin/freecoda.js"), "console.log('old');");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "freecoda", version: "0.1.0", bin: { freecoda: "bin/freecoda.js" } }));
    const source = join(directory, "fixture");
    await mkdir(join(source, "bin"), { recursive: true });
    await writeFile(join(source, "bin/freecoda.js"), "#!/usr/bin/env node\nconsole.log('updated');");
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "freecoda", version: "0.2.0", bin: { freecoda: "bin/freecoda.js" }, scripts: { postinstall: "node -e \"process.exit(93)\"" } }));
    const pack = Bun.spawn(["npm", "pack", "--ignore-scripts", "--pack-destination", directory], { cwd: source, stdout: "pipe", stderr: "pipe" });
    expect(await pack.exited).toBe(0);
    const bytes = await readFile(join(directory, "freecoda-0.2.0.tgz"));
    const digest = createHash("sha256").update(bytes).digest("hex");
    await automaticUpdate(() => {}, { entry: join(root, "bin/freecoda.js"), fetcher: (async (url: string) => url.includes("api.github.com") ? Response.json([{ tag_name: "cli-v0.2.0" }]) : new Response(url.endsWith("SHA256SUMS.txt") ? `${digest}  freecoda-0.2.0.tgz` : bytes)) as typeof fetch });
    expect(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version).toBe("0.2.0");
    expect(await readFile(join(root, "bin/freecoda.js"), "utf8")).toContain("updated");
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30000);

test.skipIf(process.platform === "win32")("bundled CLI /exit in a real PTY automatically upgrades only after the session ends", async () => {
  const directory = await mkdtemp(join(tmpdir(), "freecoda-cli-exit-test-"));
  try {
    const root = join(directory, "lib/node_modules/freecoda");
    await mkdir(join(root, "bin"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "freecoda", type: "module", version: "0.1.0", bin: { freecoda: "bin/freecoda.js" } }));
    await writeFile(join(root, "bin/freecoda.js"), 'import "../dist/index.js";');
    const buildOptions = { entrypoints: [join(import.meta.dir, "../packages/cli/src/index.ts")], outdir: join(root, "dist"), target: "node", format: "esm" };
    const build = Bun.spawn(["bun", "--eval", `const build = await Bun.build(${JSON.stringify(buildOptions)}); if (!build.success) { console.error(build.logs); process.exit(1); }`], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const buildErrors = await new Response(build.stderr).text();
    expect(await build.exited, buildErrors).toBe(0);
    const config = join(directory, "config");
    await mkdir(config);
    await writeFile(join(config, "config.json"), JSON.stringify({ server: "https://freecoda.com", trustedRoots: [], provider: { baseURL: "http://127.0.0.1:19999/v1", model: "fixture" } }));
    const fixture = join(directory, "fixture");
    await mkdir(join(fixture, "bin"), { recursive: true });
    await writeFile(join(fixture, "bin/freecoda.js"), "#!/usr/bin/env node\nconsole.log('next-session-0.2.0');");
    await writeFile(join(fixture, "package.json"), JSON.stringify({ name: "freecoda", version: "0.2.0", bin: { freecoda: "bin/freecoda.js" }, scripts: { postinstall: "node -e \"process.exit(93)\"" } }));
    const pack = Bun.spawn(["npm", "pack", "--ignore-scripts", "--pack-destination", directory], { cwd: fixture, stdout: "pipe", stderr: "pipe" });
    expect(await pack.exited).toBe(0);
    const bytes = await readFile(join(directory, "freecoda-0.2.0.tgz"));
    const digest = createHash("sha256").update(bytes).digest("hex");
    const hook = join(directory, "fetch-fixture.mjs");
    await writeFile(hook, `import {readFileSync} from 'node:fs';
      globalThis.fetch = async (url) => {
        if (url === 'https://api.github.com/repos/elliotshohet/freecoda/releases?per_page=100') return Response.json([{tag_name:'cli-v0.2.0'}]);
        if (url === 'https://github.com/elliotshohet/freecoda/releases/download/cli-v0.2.0/SHA256SUMS.txt') return new Response('${digest}  freecoda-0.2.0.tgz');
        if (url === 'https://github.com/elliotshohet/freecoda/releases/download/cli-v0.2.0/freecoda-0.2.0.tgz') return new Response(readFileSync(${JSON.stringify(join(directory, "freecoda-0.2.0.tgz"))}));
        throw new Error('Unexpected network request');
      };`);
    const harness = join(directory, "session_harness.py");
    await writeFile(harness, `import os,pty,select,sys,time,json,signal
pid,fd=pty.fork()
if pid==0:
 os.execvp('node',['node','--import',sys.argv[1],sys.argv[2],'--plain'])
output=b''; sent=False; deadline=time.time()+35
try:
 while time.time()<deadline:
  ready,_,_=select.select([fd],[],[],0.1)
  if ready:
   try: chunk=os.read(fd,65536)
   except OSError: break
   if not chunk: break
   output+=chunk
   if not sent and '›'.encode() in output:
    # Real interactive exit exercises index.ts finally, not an updater helper.
    os.write(fd,b'/exit\\n'); sent=True
  done,status=os.waitpid(pid,os.WNOHANG)
  if done:
   print(json.dumps({'status':os.waitstatus_to_exitcode(status),'sent':sent,'output':output.decode(errors='replace')}));sys.exit(0)
 else:
  os.kill(pid,signal.SIGKILL);raise RuntimeError('CLI PTY timed out')
 _,status=os.waitpid(pid,0)
 print(json.dumps({'status':os.waitstatus_to_exitcode(status),'sent':sent,'output':output.decode(errors='replace')}))
finally:
 os.close(fd)
`);
    for (const disabled of [true, false]) {
      const child = Bun.spawn(["python3", harness, hook, join(root, "bin/freecoda.js")], { cwd: directory, env: { ...process.env, FREECODA_CONFIG_DIR: config, FREECODA_AUTO_UPDATE: disabled ? "0" : "1" }, stdout: "pipe", stderr: "pipe" });
      const output = await new Response(child.stdout).text();
      const errors = await new Response(child.stderr).text();
      expect(await child.exited, errors).toBe(0);
      const result = JSON.parse(output);
      expect(result.status, result.output).toBe(0);
      expect(result.sent).toBe(true);
      expect(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version).toBe(disabled ? "0.1.0" : "0.2.0");
      if (!disabled) expect(result.output).toContain("is installed. Your next session will use it.");
    }
    const next = Bun.spawn(["node", join(root, "bin/freecoda.js")], { stdout: "pipe" });
    expect(await new Response(next.stdout).text()).toContain("next-session-0.2.0");
    expect(await next.exited).toBe(0);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60000);
