import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { getPool } from "../apps/web/lib/db";
import { configureProjectExtensions, projectExtensions } from "../apps/web/lib/cloud/extensions";
import * as store from "../apps/web/lib/cloud/store";

const pool = getPool();
const owner = randomUUID(), stranger = randomUUID();
const previousKey = process.env.CLOUD_ENCRYPTION_KEY;
let projectId: string;
beforeAll(async () => {
  if ((await pool.query("SELECT current_database() name")).rows[0].name !== "freecoda_test") throw Error("Refusing non-test database");
  process.env.CLOUD_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  for (const id of [owner, stranger]) await pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [id, "Extension fixture", `${id}@example.test`]);
  projectId = (await store.createProject(owner, "Extension fixture", { files: [{ path: "index.ts", content: "export {};" }], consentAt: new Date().toISOString() })).id;
});
afterAll(async () => {
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [[owner, stranger]]);
  if (previousKey === undefined) delete process.env.CLOUD_ENCRYPTION_KEY;
  else process.env.CLOUD_ENCRYPTION_KEY = previousKey;
  await pool.end();
});

test("cloud skills persist encrypted and remain isolated by owner and project", async () => {
  const instructions = "---\nname: cloud-fixture\ndescription: Regression instruction\n---\nAlways explain the fixture invariant before editing.";
  const installed = await configureProjectExtensions(owner, projectId, { action: "skill-text", name: "Cloud fixture", instructions });
  expect(installed.skills).toHaveLength(1);
  const id = installed.skills[0]!.id;
  expect(JSON.stringify(installed)).not.toContain("Always explain");
  const stored = await store.project(owner, projectId);
  expect(stored.payload.extensions?.skills[0]?.instructions).toContain("Always explain the fixture invariant");
  expect(stored.payload.files).toEqual([{ path: "index.ts", content: "export {};" }]);
  const ciphertext = (await pool.query("SELECT payload FROM cloud_projects WHERE id=$1", [projectId])).rows[0].payload;
  expect(ciphertext).not.toContain("Always explain");
  expect((await projectExtensions(owner, projectId)).skills[0]!.id).toBe(id);
  await expect(projectExtensions(stranger, projectId)).rejects.toThrow("not found");
  await expect(configureProjectExtensions(stranger, projectId, { action: "remove", id })).rejects.toThrow();
  const other = await store.createProject(stranger, "Other fixture", { files: [], consentAt: new Date().toISOString() });
  expect((await projectExtensions(stranger, other.id)).skills).toEqual([]);
  expect((await configureProjectExtensions(owner, projectId, { action: "toggle", id, enabled: false })).skills[0]!.enabled).toBe(false);
  expect((await projectExtensions(owner, projectId)).skills[0]!.enabled).toBe(false);
  expect((await configureProjectExtensions(owner, projectId, { action: "remove", id })).skills).toEqual([]);
});

test("cloud extension changes are blocked during queued and running tasks and recover after completion", async () => {
  const run = await store.createRun(owner, projectId, { prompt: "fixture", mode: "build", consentAt: new Date().toISOString() });
  const action = { action: "skill-text" as const, name: "During task", instructions: "Do not install while a task is active." };
  try {
    await expect(configureProjectExtensions(owner, projectId, action)).rejects.toThrow("in progress");
    await expect(configureProjectExtensions(owner, projectId, { action: "discover", id: "mcp_missing" })).rejects.toThrow("in progress");
    await expect(configureProjectExtensions(owner, projectId, { action: "tool-toggle", name: "shell", enabled: false })).rejects.toThrow("in progress");
    await store.runState(run.id, "running");
    await expect(configureProjectExtensions(owner, projectId, action)).rejects.toThrow("in progress");
    expect((await projectExtensions(owner, projectId)).skills).toEqual([]);
  } finally { await store.runState(run.id, "completed"); }
  const installed = await configureProjectExtensions(owner, projectId, action);
  expect(installed.skills).toHaveLength(1);
  expect((await store.project(owner, projectId)).payload.extensions?.skills[0]?.instructions).toContain("Do not install");
  await configureProjectExtensions(owner, projectId, { action: "remove", id: installed.skills[0]!.id });
});

test("tool selection persists without execution and refuses unconfigured tools", async () => {
  const result = await configureProjectExtensions(owner, projectId, { action: "tool-toggle", name: "shell", enabled: false });
  expect(result.disabledTools).toContain("shell");
  expect((await store.project(owner, projectId)).payload.disabledTools).toContain("shell");
  await expect(configureProjectExtensions(owner, projectId, { action: "tool-toggle", name: "mcp_unknown", enabled: true })).rejects.toThrow("Discover the tool");
  expect((await configureProjectExtensions(owner, projectId, { action: "tool-toggle", name: "shell", enabled: true })).disabledTools).not.toContain("shell");
  expect((await projectExtensions(owner, projectId)).builtins.map(tool => tool.name)).not.toContain("skill_file");
});
