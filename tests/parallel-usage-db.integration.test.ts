import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getPool } from "../apps/web/lib/db";
import { reserve, settle, uncertain } from "../apps/web/lib/usage";
import { utcDay, utcMonth } from "../packages/contracts/src";

// Guard before getPool: these tests must never connect to a hosted/production DB.
const target = new URL(process.env.DATABASE_URL || "postgresql://unconfigured");
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.pathname !== "/freecoda_test")
  throw Error("Parallel usage integration tests require loopback freecoda_test.");
const pool = getPool();
const model = "reflection/beam-free";
beforeAll(async () => {
  expect((await pool.query("SELECT current_database() AS name")).rows[0].name).toBe("freecoda_test");
  const indexes = (await pool.query("SELECT indexname FROM pg_indexes WHERE tablename='reservations'")).rows.map(row => row.indexname);
  expect(indexes).toContain("one_active_costly_reservation");
  expect(indexes).not.toContain("one_active_reservation");
});
afterAll(async () => pool.end());

async function withUser(run: (id: string) => Promise<void>) {
  const id = randomUUID();
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [id, "Parallel usage fixture", `${id}@example.test`]);
  try { await run(id); }
  finally {
    const rows = (await pool.query("SELECT id FROM reservations WHERE user_id=$1 AND status IN ('pending','uncertain')", [id])).rows;
    for (const row of rows) await settle(row.id, 0, undefined, true);
    await pool.query("DELETE FROM reservations WHERE user_id=$1", [id]);
    await pool.query("DELETE FROM usage_buckets WHERE scope=$1", [id]);
    await pool.query('DELETE FROM "user" WHERE id=$1', [id]);
  }
}
const admitted = (results: PromiseSettledResult<string>[]) => results.filter((item): item is PromiseFulfilledResult<string> => item.status === "fulfilled").map(item => item.value);
const globalBudget = async () => (await pool.query("SELECT spent_micros,reserved_micros FROM usage_buckets WHERE scope='global' AND period=$1", [utcMonth()])).rows[0] ?? { spent_micros: "0", reserved_micros: "0" };

test("database atomically admits three of twelve same-account free requests without charging buckets", async () => {
  await withUser(async user => {
    const before = await globalBudget();
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => reserve(user, model, 0)));
    const ids = admitted(results);
    expect(ids).toHaveLength(3);
    const rejected = results.filter((item): item is PromiseRejectedResult => item.status === "rejected");
    expect(rejected).toHaveLength(9);
    expect(rejected.every(item => item.reason.status === 409)).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS count FROM reservations WHERE user_id=$1 AND status='pending'", [user])).rows[0].count).toBe(3);
    expect(await globalBudget()).toEqual(before);
    expect((await pool.query("SELECT spent_micros,reserved_micros FROM usage_buckets WHERE scope=$1 AND period=$2", [user, utcDay()])).rows[0]).toEqual({ spent_micros: "0", reserved_micros: "0" });
    await Promise.all(ids.map(id => settle(id, 0)));
    const replacement = await reserve(user, model, 0);
    expect(replacement).toBeString();
    await settle(replacement, 0);
    expect(await globalBudget()).toEqual(before);
  });
});

test("a recent uncertain zero-cost request blocks every concurrent retry until reconciliation", async () => {
  await withUser(async user => {
    const original = await reserve(user, model, 0);
    await uncertain(original, "fixture-generation");
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => reserve(user, model, 0)));
    expect(admitted(results)).toHaveLength(0);
    expect(results.every(item => item.status === "rejected" && item.reason.status === 409)).toBe(true);
    await settle(original, 0, undefined, true);
    const next = await reserve(user, model, 0);
    await settle(next, 0);
  });
});

test("nonzero reservations remain serialized and their full reservation accounting is restored", async () => {
  await withUser(async user => {
    const before = await globalBudget();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => reserve(user, "fixture-costly", 1)));
    const ids = admitted(results);
    expect(ids).toHaveLength(1);
    expect((await globalBudget()).reserved_micros).toBe(String(BigInt(before.reserved_micros) + 1n));
    await expect(reserve(user, model, 0)).rejects.toThrow("reconciliation");
    await settle(ids[0], 0, undefined, true);
    expect(await globalBudget()).toEqual(before);
  });
});

test("paid-source zero-cost rows are unverified and the costly index blocks duplicate risky rows", async () => {
  await withUser(async user => {
    const id = randomUUID();
    const insert = (reservationId: string) => pool.query("INSERT INTO reservations(id,user_id,request_key,model,source,max_cost_micros,day,month) VALUES($1,$2,$1,$3,'paid',0,$4,$5)", [reservationId, user, model, utcDay(), utcMonth()]);
    await insert(id);
    await expect(reserve(user, model, 0)).rejects.toThrow("reconciliation");
    let constraint: string | undefined;
    try { await insert(randomUUID()); }
    catch (error) { constraint = (error as { constraint?: string }).constraint; }
    expect(constraint).toBe("one_active_costly_reservation");
    await settle(id, 0, undefined, true);
    const next = await reserve(user, model, 0);
    await settle(next, 0);
  });
});

test("independent accounts each retain three parallel free reservations", async () => {
  await withUser(async first => withUser(async second => {
    const before = await globalBudget();
    const [a, b] = await Promise.all([first, second].map(user => Promise.allSettled(Array.from({ length: 6 }, () => reserve(user, model, 0)))));
    expect(admitted(a)).toHaveLength(3);
    expect(admitted(b)).toHaveLength(3);
    await Promise.all([...admitted(a), ...admitted(b)].map(id => settle(id, 0)));
    expect(await globalBudget()).toEqual(before);
  }));
});
