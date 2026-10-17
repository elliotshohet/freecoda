import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { getPool } from "../apps/web/lib/db";
import { publishDraft } from "../apps/web/lib/cloud/github";
import type { RepositorySource } from "../apps/web/lib/cloud/types";

const pool = getPool();
const userId = randomUUID();
const originalFetch = globalThis.fetch;
const source: RepositorySource = {
  installationId: 123,
  owner: "fixture-owner",
  name: "fixture",
  defaultBranch: "main",
  baseSha: "a".repeat(40),
  repositoryId: 456,
  baseFiles: [{ path: "app.ts", content: "old" }],
};
beforeAll(async () => {
  if (
    (await pool.query("SELECT current_database() name")).rows[0].name !==
    "freecoda_test"
  )
    throw new Error("Refusing non-test database");
  await pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [
    userId,
    "GitHub fixture",
    `${userId}@example.test`,
  ]);
  await pool.query(
    'INSERT INTO account(id,"accountId","providerId","userId","accessToken") VALUES($1,$2,$3,$4,$5)',
    [randomUUID(), "99", "github", userId, "fake-oauth-test-token"],
  );
  process.env.GITHUB_APP_ID = "test-app";
  process.env.GITHUB_APP_SLUG = "test-app";
  process.env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
});
afterAll(async () => {
  globalThis.fetch = originalFetch;
  await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await pool.end();
});

function githubFixture({
  stale = false,
  denied = false,
  existing = false,
} = {}) {
  const mutations: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== "https://api.github.com")
      throw new Error("Unexpected network access");
    const p = url.pathname;
    if (init?.method === "POST") mutations.push(p);
    let value: unknown;
    if (p === "/user") value = { id: 99, login: "fixture-owner" };
    else if (p === "/app/installations/123")
      value = {
        id: 123,
        account: {
          id: denied ? 100 : 99,
          login: denied ? "other-owner" : "fixture-owner",
        },
      };
    else if (p === "/app/installations/123/access_tokens")
      value = { token: "fake-installation-token" };
    else if (p === "/repos/fixture-owner/fixture")
      value = {
        id: 456,
        owner: { login: "fixture-owner" },
        default_branch: "main",
      };
    else if (p === "/repos/fixture-owner/fixture/pulls")
      value = existing
        ? [{ html_url: "https://github.com/fixture-owner/fixture/pull/1" }]
        : [];
    else if (p === "/repos/fixture-owner/fixture/commits/main")
      value = { sha: (stale ? "b" : "a").repeat(40) };
    else throw new Error(`Unexpected GitHub request: ${p}`);
    return Response.json(value);
  }) as typeof fetch;
  return mutations;
}
test("stale repository base rejects publishing before any branch or PR mutation", async () => {
  const mutations = githubFixture({ stale: true });
  await expect(
    publishDraft(
      userId,
      source,
      [{ path: "app.ts", content: "new" }],
      "publication-fixture",
      "Fix app",
      "Reviewed change",
    ),
  ).rejects.toThrow("changed since import");
  expect(mutations).toEqual(["/app/installations/123/access_tokens"]);
});
test("an installation belonging to another account cannot create repository mutations", async () => {
  const mutations = githubFixture({ denied: true });
  await expect(
    publishDraft(
      userId,
      source,
      [{ path: "app.ts", content: "new" }],
      "publication-fixture",
      "Fix app",
      "Reviewed change",
    ),
  ).rejects.toThrow("owner");
  expect(mutations).toEqual([]);
});
test("retrying an existing publication returns the same PR without another write", async () => {
  const mutations = githubFixture({ existing: true });
  const first = await publishDraft(
    userId,
    source,
    [{ path: "app.ts", content: "new" }],
    "publication-fixture",
    "Fix app",
    "Reviewed change",
  );
  const second = await publishDraft(
    userId,
    source,
    [{ path: "app.ts", content: "new" }],
    "publication-fixture",
    "Fix app",
    "Reviewed change",
  );
  expect(first).toBe(second);
  expect(mutations.filter((p) => !p.endsWith("/access_tokens"))).toEqual([]);
});
