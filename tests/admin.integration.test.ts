import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHmac, randomUUID } from "node:crypto";
import { getPool } from "../apps/web/lib/db";
import { adminMetrics, requireAdmin } from "../apps/web/lib/admin";
import { GET } from "../apps/web/app/api/admin/metrics/route";
const pool = getPool();
const owner = randomUUID(), outsider = randomUUID(), reservationId = randomUUID(), unattributedId = randomUUID();
const oldAdmin = process.env.ADMIN_GITHUB_IDS;
const oldSecret = process.env.BETTER_AUTH_SECRET;
const oldClient = process.env.GITHUB_CLIENT_ID;
const oldGithubSecret = process.env.GITHUB_CLIENT_SECRET;
let ownerCookie: string, outsiderCookie: string;
beforeAll(async () => {
  const result = await pool.query("SELECT current_database() AS name");
  if (result.rows[0].name !== "freecoda_test") throw Error("Refusing non-test database.");
  process.env.ADMIN_GITHUB_IDS = "123456789";
  process.env.BETTER_AUTH_SECRET ||= "admin-fixture-auth-secret-32-characters-long";
  process.env.GITHUB_CLIENT_ID ||= "admin-fixture-client";
  process.env.GITHUB_CLIENT_SECRET ||= "admin-fixture-client-secret";
  for (const [id, githubId] of [[owner,"123456789"],[outsider,"987654321"]]) {
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,\'Admin fixture\',$2,true)', [id,`${id}@example.test`]);
    await pool.query('INSERT INTO account(id,"accountId","providerId","userId") VALUES($1,$2,\'github\',$3)', [randomUUID(),githubId,id]);
  }
  async function cookie(id: string) {
    const token = randomUUID();
    await pool.query('INSERT INTO session(id,"expiresAt",token,"userId") VALUES($1,now()+interval \'1 hour\',$2,$3)', [randomUUID(),token,id]);
    const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(token).digest("base64");
    return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
  }
  ownerCookie = await cookie(owner); outsiderCookie = await cookie(outsider);
});
afterAll(async () => {
  await pool.query("DELETE FROM reservations WHERE id=ANY($1::text[])", [[reservationId,unattributedId]]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [[owner,outsider]]);
  for (const [key,value] of Object.entries({ADMIN_GITHUB_IDS:oldAdmin,BETTER_AUTH_SECRET:oldSecret,GITHUB_CLIENT_ID:oldClient,GITHUB_CLIENT_SECRET:oldGithubSecret})) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});
const request = (cookie?: string) => new Request("http://localhost/api/admin/metrics?days=7", { headers: cookie ? { Cookie: cookie } : {} });
test("private administrator metrics reject anonymous and other signed-in users", async () => {
  expect((await GET(request())).status).toBe(401);
  expect((await GET(request(outsiderCookie))).status).toBe(403);
  expect((await requireAdmin(request(ownerCookie))).id).toBe(owner);
  const response = await GET(request(ownerCookie));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const metrics = await response.json();
  expect(metrics.period.days).toBe(7);
  expect(metrics.unavailable).toContain("Vercel infrastructure billing and credits are not imported into this dashboard.");
  expect(JSON.stringify(metrics)).not.toContain(`${owner}@example.test`);
  const invalid = await GET(new Request("http://localhost/api/admin/metrics?days=100000", { headers: {Cookie:ownerCookie} }));
  expect(invalid.status).toBe(400);
});
test("measured request totals and cost denominator stay distinct from unavailable infrastructure cost", async () => {
  const timestamp = new Date("2087-01-03T12:00:00Z");
  await pool.query("INSERT INTO reservations(id,user_id,request_key,model,source,max_cost_micros,actual_cost_micros,input_tokens,output_tokens,day,month,status,created_at) VALUES($1,$2,$1,'fixture/free','free',100,75,10,5,'2087-01-03','2087-01','settled',$3)", [reservationId,owner,timestamp]);
  const metrics = await adminMetrics(7,new Date("2087-01-04T00:00:00Z"));
  expect(Number(metrics.inference.cost_micros)).toBe(75);
  expect(metrics.inference.active_accounts).toBe(1);
  expect(metrics.inference.costMicrosPerActiveAccount).toBe(75);
  expect(metrics.daily[0].day).toBe("2087-01-03");
  await pool.query("INSERT INTO reservations(id,user_id,request_key,model,source,max_cost_micros,actual_cost_micros,day,month,status,created_at) VALUES($1,NULL,$1,'fixture/free','free',25,25,'2087-01-03','2087-01','settled',$2)", [unattributedId,timestamp]);
  const unattributed = await adminMetrics(7,new Date("2087-01-04T00:00:00Z"));
  expect(unattributed.inference.unattributed_requests).toBe(1);
  expect(unattributed.inference.costMicrosPerActiveAccount).toBeNull();
  const empty = await adminMetrics(7,new Date("2020-01-04T00:00:00Z"));
  expect(empty.inference.costMicrosPerActiveAccount).toBeNull();
});
