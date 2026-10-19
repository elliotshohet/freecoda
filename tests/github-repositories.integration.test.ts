import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { getPool } from "../apps/web/lib/db";
import { hash } from "../apps/web/lib/security";
import { repositories, importRepository } from "../apps/web/lib/cloud/github";
import { handle } from "../apps/web/lib/http";
import {
  githubRepositoryRoute,
  githubRepositorySettingsSchema,
} from "../apps/web/lib/github-repositories";
const pool = getPool();
const userId = randomUUID(),
  otherId = randomUUID();
const token = "fixture-repository-device-token-" + randomUUID();
const originalFetch = globalThis.fetch;
const setting = {
  repositoryId: 456,
  installationId: 123,
  owner: "fixture-owner",
  name: "fixture",
  branch: "main",
  appDirectory: "apps/web",
  enabled: true,
};
let denied = false;
let revokedGithubLogin = false;
let allowWriteImport = false;
let missingBranch = false;
let unavailableInstallation: number | undefined;
let unavailableStatus = 403;
let suspendedUnrelated = false;
let mutations: string[] = [];
async function request(method: string, body?: unknown, deviceToken = token) {
  return handle(
    async () =>
      (await githubRepositoryRoute(
        new Request("https://freecoda.com/api/v1/github/repositories", {
          method,
          headers: {
            Authorization: `Bearer ${deviceToken}`,
            "Content-Type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        "github/repositories",
      ))!,
  );
}
beforeAll(async () => {
  if (
    (await pool.query("SELECT current_database() name")).rows[0].name !==
    "freecoda_test"
  )
    throw new Error("Refusing non-test database");
  for (const id of [userId, otherId])
    await pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [
      id,
      "GitHub settings fixture",
      `${id}@example.test`,
    ]);
  await pool.query(
    'INSERT INTO account(id,"accountId","providerId","userId","accessToken") VALUES($1,$2,$3,$4,$5)',
    [randomUUID(), "99", "github", userId, "fake-oauth-token"],
  );
  await pool.query(
    "INSERT INTO devices(id,user_id,token_hash,name,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",
    [randomUUID(), userId, hash(token), "fixture"],
  );
  process.env.GITHUB_APP_ID = "test-app";
  process.env.GITHUB_APP_SLUG = "test-app";
  process.env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== "https://api.github.com")
      throw new Error("Unexpected external request");
    const p = url.pathname;
    if (init?.method === "POST") {
      mutations.push(p);
      const body = JSON.parse(String(init.body));
      expect(body.permissions.contents).toBe(
        allowWriteImport ? "write" : "read",
      );
      if (allowWriteImport)
        expect(body.permissions.pull_requests).toBe("write");
      else expect(body.permissions.pull_requests).toBeUndefined();
    }
    if (p === "/app/installations")
      return Response.json([
        { id: 123, account: { id: 99, login: "fixture-owner" } },
        {
          id: 124,
          account: { id: 100, login: "other-owner" },
          suspended_at: suspendedUnrelated ? "2026-10-19T00:00:00Z" : null,
        },
      ]);
    if (p === `/app/installations/${unavailableInstallation}/access_tokens`)
      return Response.json(
        { message: "PROVIDER_PRIVATE_ERROR fake-installation-token" },
        { status: unavailableStatus },
      );
    if (p === "/app/installations/124/access_tokens")
      return Response.json({ token: "other-installation-token" });
    if (p === "/installation/repositories")
      return Response.json({
        repositories:
          init?.headers &&
          (init.headers as Record<string, string>).Authorization ===
            "Bearer other-installation-token"
            ? [
                {
                  id: 789,
                  name: "private",
                  owner: { login: "other-owner" },
                  default_branch: "main",
                  private: true,
                  created_at: "2025-01-01T00:00:00Z",
                },
              ]
            : [
                {
                  id: 456,
                  name: "fixture",
                  owner: { login: "fixture-owner" },
                  default_branch: "main",
                  private: true,
                  created_at: "2025-02-01T00:00:00Z",
                },
              ],
      });
    if (p === "/repos/other-owner/private")
      return Response.json({ permissions: { push: false } });
    if (p === "/user") return revokedGithubLogin ? Response.json({message:"PROVIDER_PRIVATE_ERROR fake-oauth-token"},{status:401}) : Response.json({ id: 99, login: "fixture-owner" });
    if (p === "/app/installations/123")
      return Response.json({
        id: 123,
        account: {
          id: denied ? 100 : 99,
          login: denied ? "other-owner" : "fixture-owner",
        },
      });
    if (p === "/app/installations/123/access_tokens")
      return Response.json({ token: "fake-installation-token" });
    if (p === "/repos/fixture-owner/fixture")
      return Response.json({
        id: 456,
        owner: { login: "fixture-owner" },
        default_branch: "main",
      });
    if (p === "/repos/fixture-owner/fixture/branches/main")
      return missingBranch
        ? Response.json({}, { status: 404 })
        : Response.json({ name: "main" });
    if (p === "/repos/fixture-owner/fixture/contents/apps/web")
      return Response.json([{ name: "page.tsx", type: "file" }]);
    throw new Error(`Unexpected GitHub request ${p}`);
  }) as typeof fetch;
});
afterAll(async () => {
  globalThis.fetch = originalFetch;
  await pool.query('DELETE FROM "user" WHERE id=ANY($1)', [[userId, otherId]]);
  await pool.end();
});
test("device account saves validated settings and another user never receives them", async () => {
  const saved = await request("PUT", { repositories: [setting] });
  expect(saved.status).toBe(200);
  const savedBody = await saved.text();
  expect(savedBody).not.toContain("fake-installation-token");
  expect(savedBody).not.toContain("fake-oauth-token");
  expect(await (await request("GET")).json()).toEqual({
    repositories: [setting],
  });
  expect(
    (
      await pool.query(
        "SELECT settings FROM github_repository_settings WHERE user_id=$1",
        [otherId],
      )
    ).rows,
  ).toEqual([]);
});
test("another installation owner is denied before minting access and previous settings survive", async () => {
  denied = true;
  mutations = [];
  try {
    expect((await request("PUT", { repositories: [setting] })).status).toBe(
      403,
    );
    expect(mutations).toEqual([]);
    expect(await (await request("GET")).json()).toEqual({
      repositories: [setting],
    });
  } finally {
    denied = false;
  }
});
test("mismatched repository identity and missing branch cannot overwrite configuration", async () => {
  expect(
    (
      await request("PUT", {
        repositories: [{ ...setting, repositoryId: 999 }],
      })
    ).status,
  ).toBe(403);
  missingBranch = true;
  try {
    expect((await request("PUT", { repositories: [setting] })).status).toBe(
      404,
    );
  } finally {
    missingBranch = false;
  }
  expect(await (await request("GET")).json()).toEqual({
    repositories: [setting],
  });
});
test("revoked device cannot read or modify settings", async () => {
  const revoked = "revoked-fixture-token-" + randomUUID();
  await pool.query(
    "INSERT INTO devices(id,user_id,token_hash,name,expires_at,revoked_at) VALUES($1,$2,$3,'revoked',now()+interval '1 day',now())",
    [randomUUID(), userId, hash(revoked)],
  );
  expect((await request("GET", undefined, revoked)).status).toBe(401);
  expect((await request("PUT", { repositories: [] }, revoked)).status).toBe(
    401,
  );
});
test("rejects traversal and duplicate repository settings; empty list removes configuration", async () => {
  for (const appDirectory of [
    "../outside",
    "/absolute",
    "apps/../secret",
    "apps\\web",
  ])
    expect(
      githubRepositorySettingsSchema.safeParse({
        repositories: [{ ...setting, appDirectory }],
      }).success,
    ).toBe(false);
  expect(
    (await request("PUT", { repositories: [setting, setting] })).status,
  ).toBe(400);
  expect((await request("PUT", { repositories: [] })).status).toBe(200);
  expect(await (await request("GET")).json()).toEqual({ repositories: [] });
});

test("live repository listing excludes installations whose repositories the user cannot write", async () => {
  const result = await repositories(userId);
  expect(result.repos).toEqual([
    {
      repositoryId: 456,
      installationId: 123,
      owner: "fixture-owner",
      name: "fixture",
      defaultBranch: "main",
      private: true,
      createdAt: "2025-02-01T00:00:00Z",
    },
  ]);
  expect(result.installUrl).toBe(
    "https://github.com/apps/test-app/installations/new",
  );
});

test("unavailable unrelated installations do not hide accessible granted repositories", async () => {
  for (const status of [403, 404, 500]) {
    unavailableInstallation = 124;
    unavailableStatus = status;
    try {
      const result = await repositories(userId);
      expect(result.repos.map((r) => r.repositoryId)).toEqual([456]);
      expect(result.warning).toContain("Refresh connected repositories");
      expect(result.installUrl).toBe(
        "https://github.com/apps/test-app/installations/new",
      );
      expect(JSON.stringify(result)).not.toContain("PROVIDER_PRIVATE_ERROR");
      expect(JSON.stringify(result)).not.toContain("fake-installation-token");
    } finally {
      unavailableInstallation = undefined;
    }
  }
  suspendedUnrelated = true;
  mutations = [];
  try {
    expect(
      (await repositories(userId)).repos.map((r) => r.repositoryId),
    ).toEqual([456]);
    expect(mutations).not.toContain("/app/installations/124/access_tokens");
  } finally {
    suspendedUnrelated = false;
  }
});
test("stale inaccessible selection returns actionable sanitized errors and cannot save", async () => {
  for (const status of [403, 404]) {
    unavailableInstallation = 123;
    unavailableStatus = status;
    try {
      const response = await request("PUT", { repositories: [setting] });
      expect(response.status).toBe(status);
      const body = await response.text();
      expect(body).toContain("Refresh connected repositories");
      expect(body).toContain("GitHub App installation");
      expect(body).not.toContain("PROVIDER_PRIVATE_ERROR");
      expect(body).not.toContain("fake-installation-token");
      expect(await (await request("GET")).json()).toEqual({ repositories: [] });
    } finally {
      unavailableInstallation = undefined;
    }
  }
});

test("selected import rechecks current repository grant before reading source", async () => {
  unavailableInstallation = 123;
  unavailableStatus = 403;
  allowWriteImport = true;
  mutations = [];
  try {
    const response = await handle(async () => {
      await importRepository(userId, {
        installationId: 123,
        owner: "fixture-owner",
        repo: "fixture",
      });
      return Response.json({ ok: true });
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Refresh connected repositories");
    expect(mutations).toEqual(["/app/installations/123/access_tokens"]);
  } finally {
    unavailableInstallation = undefined;
    allowWriteImport = false;
  }
});
test("revoked GitHub login returns a safe reconnect action without listing installations", async () => {
  revokedGithubLogin = true;
  mutations = [];
  try {
    const response = await handle(
      async () =>
        (await githubRepositoryRoute(
          new Request("https://freecoda.com/api/v1/github/repos", {
            headers: { Authorization: `Bearer ${token}` },
          }),
          "github/repos",
        ))!,
    );
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain("Reconnect GitHub");
    expect(body).not.toContain("PROVIDER_PRIVATE_ERROR");
    expect(body).not.toContain("fake-oauth-token");
    expect(mutations).toEqual([]);
  } finally {
    revokedGithubLogin = false;
  }
});
