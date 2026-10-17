import { test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { getPool } from "../apps/web/lib/db";
import {
  reserve,
  settle,
  uncertain,
  usageSnapshot,
} from "../apps/web/lib/usage";
import {
  startDevice,
  approveDevice,
  pollDevice,
  identity,
  hash,
  requireInvite,
  rateLimit,
  cleanupExpired,
} from "../apps/web/lib/security";
import { selectAd, recordAd, verifyAd } from "../apps/web/lib/ads";
import { route } from "../apps/web/lib/api";
import { utcDay, utcMonth } from "../packages/contracts/src";
const pool = getPool();
let userId: string;
beforeAll(async () => {
  const { rows } = await pool.query("SELECT current_database() AS name");
  if (rows[0].name !== "freecoda_test")
    throw new Error("Integration tests refuse to run outside freecoda_test.");
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE ad_events,campaigns,sponsor_inquiries,request_limits,device_requests,devices,profiles,invitations,usage_buckets,reservations,"user" CASCADE',
  );
  userId = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
    [userId, "Integration fixture", userId + "@example.test"],
  );
  await pool.query("INSERT INTO invitations(email) VALUES($1)", [
    userId + "@example.test",
  ]);
  await requireInvite(userId);
});
afterAll(async () => pool.end());
test("only one parallel request can reserve a user allowance", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => reserve(userId, "fixture", 60_000)),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await usageSnapshot(userId)).freeRemainingMicros).toBe(40_000);
  const id = (
    results.find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<string>
  ).value;
  await settle(id, 10_000);
  await settle(id, 10_000);
  expect((await usageSnapshot(userId)).freeRemainingMicros).toBe(90_000);
});
test("shared monthly budget reserves atomically across accounts", async () => {
  await pool.query(
    "INSERT INTO usage_buckets(scope,period,spent_micros) VALUES('global',$1,61950000)",
    [utcMonth()],
  );
  const other = randomUUID();
  await pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [
    other,
    "Other fixture",
    other + "@example.test",
  ]);
  const results = await Promise.allSettled([
    reserve(userId, "fixture", 40_000),
    reserve(other, "fixture", 40_000),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const { rows } = await pool.query(
    "SELECT spent_micros+reserved_micros AS total FROM usage_buckets WHERE scope='global'",
  );
  expect(Number(rows[0].total)).toBeLessThanOrEqual(62_000_000);
});
test("uncertain requests keep their reservation until reconciled", async () => {
  const id = await reserve(userId, "fixture", 30_000);
  await uncertain(id, "generation-fixture");
  await expect(reserve(userId, "fixture", 1)).rejects.toThrow("reconciliation");
  expect((await usageSnapshot(userId)).freeRemainingMicros).toBe(70_000);
  await settle(id, 2000, { generationId: "generation-fixture" });
  expect((await usageSnapshot(userId)).freeRemainingMicros).toBe(98_000);
});
test("UTC reset ignores old daily buckets but retains monthly spend", async () => {
  await pool.query(
    "INSERT INTO usage_buckets(scope,period,spent_micros) VALUES($1,$2,100000)",
    [userId, "2000-01-01"],
  );
  expect((await usageSnapshot(userId)).freeRemainingMicros).toBe(100000);
});
test("device token is issued once, hashed at rest, and revocable", async () => {
  const start = await startDevice("Test terminal");
  await approveDevice(start.userCode, userId);
  const result = await pollDevice(start.deviceCode);
  expect(result.status).toBe("approved");
  if (!("token" in result)) throw new Error("Token missing");
  const req = new Request("http://localhost/api/v1/usage", {
    headers: { Authorization: `Bearer ${result.token}` },
  });
  expect((await identity(req)).id).toBe(userId);
  const { rows } = await pool.query("SELECT token_hash FROM devices");
  expect(rows[0].token_hash).not.toBe(result.token);
  expect(rows[0].token_hash).toBe(hash(result.token!));
  await expect(pollDevice(start.deviceCode)).rejects.toThrow("consumed");
  await pool.query("UPDATE devices SET revoked_at=now()");
  await expect(identity(req)).rejects.toThrow("revoked");
});
test("expired device codes and uninvited approvals fail", async () => {
  const start = await startDevice("Test");
  await pool.query(
    "UPDATE device_requests SET expires_at=now()-interval '1 second'",
  );
  await expect(approveDevice(start.userCode, userId)).rejects.toThrow(
    "expired",
  );
  await expect(pollDevice(start.deviceCode)).rejects.toThrow("expired");
  await pool.query("DELETE FROM invitations");
  await expect(requireInvite(userId)).rejects.toThrow("invite-only");
});
test("house announcement is not a paid impression", async () => {
  const ad = await selectAd("web");
  expect(ad.id).toBeNull();
  expect(ad).not.toHaveProperty("token");
  expect((await pool.query("SELECT * FROM ad_events")).rowCount).toBe(0);
});
test("signed campaign events deduplicate and enforce impression ceiling", async () => {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO campaigns(id,sponsor,headline,description,url,placement,starts_at,ends_at,active,impression_limit) VALUES($1,'Fixture sponsor','Fixture headline','Fixture copy','https://example.test','both',now()-interval '1 day',now()+interval '1 day',true,1)",
    [id],
  );
  const a = await selectAd("web"),
    b = await selectAd("terminal");
  if (!("token" in a) || !("token" in b)) throw new Error("Campaign missing");
  await Promise.all([
    recordAd(a.token, "impression"),
    recordAd(a.token, "impression"),
    recordAd(b.token, "impression"),
  ]);
  await recordAd(a.token, "click");
  await recordAd(a.token, "click");
  const { rows } = await pool.query("SELECT impressions,clicks FROM campaigns");
  expect(Number(rows[0].impressions)).toBe(1);
  expect(Number(rows[0].clicks)).toBe(1);
  expect((await selectAd("web")).id).toBeNull();
  expect(() => verifyAd(a.token + "modified")).toThrow("expired");
});
test("API refuses unauthenticated mutations and has no paid endpoint", async () => {
  const unauthorized = await route(
    new Request("http://localhost/api/v1/devices/revoke", {
      method: "POST",
      headers: {
        Origin: "https://untrusted.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: randomUUID() }),
    }),
  );
  expect(unauthorized.status).toBe(403);
  const oldPaid = await route(
    new Request("http://localhost/api/v1/billing/checkout", { method: "POST" }),
  );
  expect(oldPaid.status).toBe(404);
  const ad = await route(
    new Request("http://localhost/api/v1/ads?placement=web"),
  );
  expect(ad.status).toBe(200);
  expect((await ad.json()).id).toBeNull();
});

test("rate limit expiry handles mixed windows without deleting active allowances", async () => {
  await rateLimit("minute-fixture", 1, 60);
  await rateLimit("hour-fixture", 1, 3600);
  await rateLimit("same-key", 1, 60);
  await rateLimit("same-key", 1, 3600);
  await pool.query(
    "INSERT INTO request_limits(key,bucket,count,expires_at) VALUES('expired-minute',1,1,now()-interval '1 second'),('expired-hour',2,1,now()-interval '1 second')",
  );
  await cleanupExpired();
  expect((await pool.query("SELECT * FROM request_limits")).rowCount).toBe(4);
  await expect(rateLimit("minute-fixture", 1, 60)).rejects.toThrow(
    "Too many requests",
  );
  await expect(rateLimit("hour-fixture", 1, 3600)).rejects.toThrow(
    "Too many requests",
  );
});
