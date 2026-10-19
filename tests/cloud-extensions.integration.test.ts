import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { getPool } from "../apps/web/lib/db";
import { configureProjectExtensions, projectExtensions, projectSkill, previewProjectPlugin } from "../apps/web/lib/cloud/extensions";
import { cloudRoute } from "../apps/web/lib/cloud/api";
import * as store from "../apps/web/lib/cloud/store";

const pool = getPool();
const owner = randomUUID(), stranger = randomUUID();
const previousKey = process.env.CLOUD_ENCRYPTION_KEY;
const previousEnvironment = Object.fromEntries(["BETTER_AUTH_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "CLOUD_WORKSPACES_ENABLED", "CLOUD_PREVIEW_SECRET"].map(key => [key, process.env[key]]));
let ownerCookie: string, strangerCookie: string;
let projectId: string;
beforeAll(async () => {
  if ((await pool.query("SELECT current_database() name")).rows[0].name !== "freecoda_test") throw Error("Refusing non-test database");
  process.env.CLOUD_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  for (const id of [owner, stranger]) await pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [id, "Extension fixture", `${id}@example.test`]);
  process.env.BETTER_AUTH_SECRET ||= "cloud-api-fixture-secret-32-characters";
  process.env.GITHUB_CLIENT_ID ||= "cloud-api-fixture-client";
  process.env.GITHUB_CLIENT_SECRET ||= "cloud-api-fixture-client-secret";
  process.env.CLOUD_WORKSPACES_ENABLED = "true";
  process.env.CLOUD_PREVIEW_SECRET = "cloud-api-fixture-preview-secret-32-characters";
  const cookies: string[] = [];
  for (const id of [owner, stranger]) {
    await pool.query("INSERT INTO invitations(email) VALUES($1)", [`${id}@example.test`]);
    const token = randomUUID();
    await pool.query(`INSERT INTO session(id,"expiresAt",token,"userId") VALUES($1,now()+interval '1 hour',$2,$3)`, [randomUUID(), token, id]);
    const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(token).digest("base64");
    cookies.push(`better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`);
  }
  [ownerCookie, strangerCookie] = cookies as [string, string];
  projectId = (await store.createProject(owner, "Extension fixture", { files: [{ path: "index.ts", content: "export {};" }], consentAt: new Date().toISOString() })).id;
});
afterAll(async () => {
  await pool.query("DELETE FROM invitations WHERE email=ANY($1::text[])", [[`${owner}@example.test`, `${stranger}@example.test`]]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [[owner, stranger]]);
  if (previousKey === undefined) delete process.env.CLOUD_ENCRYPTION_KEY;
  else process.env.CLOUD_ENCRYPTION_KEY = previousKey;
  for (const [key, value] of Object.entries(previousEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await pool.end();
});

test("cloud skills persist encrypted and remain isolated by owner and project", async () => {
  const instructions = "---\nname: cloud-fixture\ndescription: Regression instruction\n---\nAlways explain the fixture invariant before editing.";
  const installed = await configureProjectExtensions(owner, projectId, { action: "skill-text", name: "Cloud fixture", instructions });
  expect(installed.skills).toHaveLength(1);
  const id = installed.skills[0]!.id;
  expect(JSON.stringify(installed)).not.toContain("Always explain");
  const read = await projectSkill(owner, projectId, id);
  expect(read.instructions).toContain("Always explain the fixture invariant");
  expect(read).not.toHaveProperty("servers");
  await expect(projectSkill(stranger, projectId, id)).rejects.toThrow("not found");
  await expect(projectSkill(owner, projectId, "skill_missing")).rejects.toThrow("not found");
  const unconsented = await store.createProject(owner, "Unconsented read fixture", { files: [] } as any);
  await expect(projectSkill(owner, unconsented.id, id)).rejects.toThrow("consent");
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


test("reviewed plugin installation persists atomically with project ownership and hosted URL boundaries", async () => {
  const source = "https://example.com/reviewed-plugin.json";
  const manifest = { version: 1 as const, name: "Reviewed fixture", skills: [], servers: [{ name: "Public fixture", url: "https://example.com/mcp" }] };
  const before = await projectExtensions(owner, projectId);
  await expect(previewProjectPlugin(stranger, projectId, source)).rejects.toThrow("not found");
  await expect(configureProjectExtensions(stranger, projectId, { action: "plugin-install", source, manifest })).rejects.toThrow();
  await expect(configureProjectExtensions(owner, projectId, { action: "plugin-install", source, manifest: { ...manifest, servers: [...manifest.servers, { name: "Forbidden", url: "http://127.0.0.1:8080/mcp" }] } })).rejects.toThrow("HTTPS");
  expect(await projectExtensions(owner, projectId)).toEqual(before);
  const installed = await configureProjectExtensions(owner, projectId, { action: "plugin-install", source, manifest });
  expect(installed.plugins).toHaveLength(1);
  expect(installed.plugins![0]!.name).toBe("Reviewed fixture");
  expect(installed.servers).toHaveLength(1);
  expect(installed.servers[0]!.checkedAt).toBeNull();
  expect(installed.servers[0]!.status).toBe("not-checked");
  await expect(configureProjectExtensions(stranger, projectId, { action: "plugin-remove", id: installed.plugins![0]!.id })).rejects.toThrow();
  const removed = await configureProjectExtensions(owner, projectId, { action: "plugin-remove", id: installed.plugins![0]!.id });
  expect(removed.plugins).toEqual([]);
  expect(removed.servers).toEqual([]);
});


test("skill content HTTP route authenticates browser ownership and keeps responses private", async () => {
  const installed = await configureProjectExtensions(owner, projectId, { action: "skill-text", name: "HTTP read fixture", instructions: "Read this exact installed instruction." });
  const id = installed.skills[0]!.id;
  const request = (skill: string, cookie?: string) => new Request(`http://localhost/api/web/projects/${projectId}/extensions?skill=${encodeURIComponent(skill)}`, { headers: cookie ? { Cookie: cookie } : {} });
  expect((await cloudRoute(request(id))).status).toBe(401);
  expect((await cloudRoute(request(id, strangerCookie))).status).toBe(404);
  expect((await cloudRoute(request("skill_missing", ownerCookie))).status).toBe(404);
  const response = await cloudRoute(request(id, ownerCookie));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.skill.instructions).toBe("Read this exact installed instruction.");
  expect(body).not.toHaveProperty("servers");
  await configureProjectExtensions(owner, projectId, { action: "remove", id });
});
