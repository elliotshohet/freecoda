import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { repositoryMap } from "../packages/core/src/repository-map";
import { Workspace } from "../packages/core/src/workspace";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "freecoda-repository-map-"));
});
afterEach(async () => rm(root, { recursive: true, force: true }));

test("maps mixed language declarations while honoring ignore and symlink boundaries", async () => {
  await mkdir(path.join(root, "src"));
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), "ignored/\n");
  await mkdir(path.join(root, "ignored"));
  await writeFile(path.join(root, "ignored/secret.ts"), "export const hidden = 1;");
  await writeFile(path.join(root, "src/app.ts"), "export function boot() {}\nclass App {}\nconst helper = () => 1;");
  await writeFile(path.join(root, "src/worker.py"), "def run_job():\n    pass\nclass Worker:\n    pass");
  await writeFile(path.join(root, "node_modules/pkg/index.ts"), "export const dependency = true;");
  await symlink("/etc", path.join(root, "external"));

  const result = await repositoryMap(await Workspace.open(root, async () => true));
  expect(result.files).toEqual([
    { path: "src/app.ts", symbols: ["boot", "App", "helper"] },
    { path: "src/worker.py", symbols: ["run_job", "Worker"] },
  ]);
  expect(result.truncated).toBe(false);
  expect(result.note).toContain("not executed");
});

test("bounds file count and source bytes and reports truncation", async () => {
  for (let index = 0; index < 125; index++) {
    await writeFile(path.join(root, `file-${String(index).padStart(3, "0")}.ts`), "export const item = 1;");
  }
  const byCount = await repositoryMap(await Workspace.open(root, async () => true));
  expect(byCount.files).toHaveLength(120);
  expect(byCount.truncated).toBe(true);

  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const content = `export const item = "${"x".repeat(119_900)}";`;
  for (let index = 0; index < 6; index++) {
    await writeFile(path.join(root, `large-${index}.ts`), content);
  }
  const byBytes = await repositoryMap(await Workspace.open(root, async () => true));
  expect(byBytes.limits.sourceBytes).toBe(512 * 1024);
  expect(byBytes.truncated).toBe(true);
  expect(byBytes.files.length).toBeGreaterThan(0);
});

test("supports bounded cloud source adapters and propagates cancellation", async () => {
  const reads: string[] = [];
  const source = {
    files: async () => ["one.ts", "two.py", "three.ts"],
    read: async (file: string) => { reads.push(file); return file.endsWith(".py") ? "def task(): pass" : "export function start() {}"; },
  };
  const result = await repositoryMap(source, { maxFiles: 2 });
  expect(result.files.map(file => file.path)).toEqual(["one.ts", "two.py"]);
  expect(result.limits.files).toBe(2);
  expect(result.truncated).toBe(true);
  const controller = new AbortController();
  reads.length = 0;
  await expect(repositoryMap({ ...source, read: async file => {
    reads.push(file);
    controller.abort();
    throw new DOMException("Stopped", "AbortError");
  } }, { signal: controller.signal })).rejects.toThrow();
  expect(reads).toEqual(["one.ts"]);
});
