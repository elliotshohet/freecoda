import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rm,
  symlink,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  Workspace,
  runShell,
  redactSecrets,
  validateBaseURL,
} from "../packages/core/src";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "freecoda-tools-"));
});
afterEach(async () => rm(root, { recursive: true, force: true }));
test("context excludes credentials, git files, nested ignores and symlinks", async () => {
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, ".gitignore"), "private/\n");
  await writeFile(path.join(root, "src/.gitignore"), "hidden.ts\n");
  await writeFile(path.join(root, "src/hidden.ts"), "secret");
  await writeFile(path.join(root, "src/index.ts"), "export const answer = 42;");
  await writeFile(path.join(root, ".env.local"), "PASSWORD=hidden");
  await symlink("/etc/passwd", path.join(root, "passwd"));
  const ws = await Workspace.open(root, async () => true);
  const files = await ws.files();
  expect(files).toContain("src/index.ts");
  expect(files).not.toContain("src/hidden.ts");
  expect(files).not.toContain(".env.local");
  expect(files).not.toContain("passwd");
  await expect(ws.read(".env.local")).rejects.toThrow("ignored");
  await expect(ws.read("passwd")).rejects.toThrow("Symlinks");
  await expect(ws.read("../outside")).rejects.toThrow("inside");
  await expect(ws.write("../outside", "x")).rejects.toThrow("inside");
});
test("a denied write preserves existing edits", async () => {
  await writeFile(path.join(root, "a.ts"), "user work\n");
  const ws = await Workspace.open(root, async () => false);
  expect(await ws.replace("a.ts", "user work", "agent work")).toContain(
    "declined",
  );
  expect(await readFile(path.join(root, "a.ts"), "utf8")).toBe("user work\n");
});
test("edit adapter preserves indentation and rejects ambiguous matches", async () => {
  await writeFile(path.join(root, "a.ts"), "  one\n  two\n");
  const ws = await Workspace.open(root, async () => true);
  await ws.replace("a.ts", "one\ntwo", "three\nfour");
  expect(await readFile(path.join(root, "a.ts"), "utf8")).toBe(
    "  three\n  four\n",
  );
  await writeFile(path.join(root, "a.ts"), "same same");
  await expect(ws.replace("a.ts", "same", "other")).rejects.toThrow(
    "ambiguous",
  );
});
test("concurrent edits during approval are never overwritten", async () => {
  await writeFile(path.join(root, "a.ts"), "old");
  const ws = await Workspace.open(root, async () => {
    await writeFile(path.join(root, "a.ts"), "new user work");
    return true;
  });
  await expect(ws.replace("a.ts", "old", "agent")).rejects.toThrow("changed");
  expect(await readFile(path.join(root, "a.ts"), "utf8")).toBe("new user work");
});
test("write cannot follow a directory replaced by symlink at approval", async () => {
  await mkdir(path.join(root, "src"));
  const outside = await mkdtemp(path.join(tmpdir(), "freecoda-outside-"));
  try {
    const ws = await Workspace.open(root, async () => {
      await rm(path.join(root, "src"), { recursive: true });
      await symlink(outside, path.join(root, "src"));
      return true;
    });
    await expect(ws.write("src/new.ts", "bad")).rejects.toThrow("Symlinks");
    await expect(stat(path.join(outside, "new.ts"))).rejects.toThrow();
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});
test("shell refuses denied commands and removes provider secrets from environment", async () => {
  const denied = await runShell(
    "touch should-not-exist",
    root,
    async () => false,
  );
  expect(denied.output).toContain("declined");
  await expect(stat(path.join(root, "should-not-exist"))).rejects.toThrow();
  process.env.FREECODA_PROVIDER_KEY = "test-key";
  const result = await runShell(
    "printenv FREECODA_PROVIDER_KEY",
    root,
    async () => true,
  );
  expect(result.output).not.toContain("test-key");
  delete process.env.FREECODA_PROVIDER_KEY;
});
test("provider URLs refuse cleartext external hosts and embedded credentials", () => {
  expect(validateBaseURL("http://localhost:11434/v1")).toBe(
    "http://localhost:11434/v1",
  );
  expect(() => validateBaseURL("http://example.com/v1")).toThrow();
  expect(() => validateBaseURL("https://key@example.com/v1")).toThrow();
  expect(redactSecrets("api_key=abcdefghijklmnop")).not.toContain(
    "abcdefghijklmnop",
  );
});
