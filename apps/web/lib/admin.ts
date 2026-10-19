import { sessionUser } from "./auth";
import { getPool, transaction } from "./db";
import { ApiError } from "./http";

export function configuredAdminIds(value = process.env.ADMIN_GITHUB_IDS || "") {
  return new Set(value.split(",").map(id => id.trim()).filter(id => /^[1-9][0-9]{0,19}$/.test(id)));
}
export function adminAccountAllowed(accountIds: string[], configured = configuredAdminIds()) {
  return accountIds.some(id => configured.has(id));
}
export async function requireAdmin(request: Request) {
  // Device tokens intentionally cannot access private business metrics.
  if (request.headers.has("authorization")) throw new ApiError(403, "Administrator browser sign-in required.");
  const user = await sessionUser(request);
  if (!user) throw new ApiError(401, "Sign in to your administrator account.");
  const allowed = configuredAdminIds();
  if (!allowed.size) throw new ApiError(403, "Administrator access is not configured.");
  const { rows } = await getPool().query(
    'SELECT a."accountId" FROM account a LEFT JOIN profiles p ON p.user_id=a."userId" WHERE a."userId"=$1 AND a."providerId"=\'github\' AND COALESCE(p.suspended,false)=false',
    [user.id],
  );
  if (!adminAccountAllowed(rows.map(row => row.accountId), allowed)) throw new ApiError(403, "Administrator access required.");
  return user;
}
export function adminPeriod(raw: string | null | undefined) {
  if (!raw) return 30;
  if (!["7", "30", "90"].includes(raw)) throw new ApiError(400, "Choose a 7, 30 or 90 day observation period.");
  return Number(raw);
}
export async function adminMetrics(days = 30, now = new Date()) {
  if (![7, 30, 90].includes(days)) throw new ApiError(400, "Invalid observation period.");
  const from = new Date(now.getTime() - days * 86400000);
  const args = [from, now];
  const results = await transaction(async db => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await db.query("SET LOCAL statement_timeout = '10s'");
    return [
    await db.query('SELECT count(*)::int AS total,count(*) FILTER (WHERE "createdAt">=$1 AND "createdAt"<$2)::int AS signups FROM "user"', args),
    await db.query(`SELECT count(*)::int AS requests,count(DISTINCT user_id)::int AS active_accounts,
      count(*) FILTER (WHERE user_id IS NULL)::int AS unattributed_requests,
      count(*) FILTER (WHERE status='settled')::int AS settled,
      count(*) FILTER (WHERE status IN ('pending','uncertain'))::int AS unresolved,
      count(*) FILTER (WHERE status='released')::int AS released,
      COALESCE(sum(actual_cost_micros) FILTER (WHERE status='settled'),0)::text AS cost_micros,
      COALESCE(sum(input_tokens) FILTER (WHERE status='settled'),0)::text AS input_tokens,
      COALESCE(sum(output_tokens) FILTER (WHERE status='settled'),0)::text AS output_tokens
      FROM reservations WHERE created_at>=$1 AND created_at<$2`, args),
    await db.query(`SELECT model,count(*)::int AS requests,COALESCE(sum(actual_cost_micros) FILTER (WHERE status='settled'),0)::text AS cost_micros,
      count(*) FILTER (WHERE status IN ('pending','uncertain'))::int AS unresolved FROM reservations
      WHERE created_at>=$1 AND created_at<$2 GROUP BY model ORDER BY count(*) DESC`, args),
    await db.query(`SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,count(*)::int AS requests,count(DISTINCT user_id)::int AS accounts,
      COALESCE(sum(actual_cost_micros) FILTER (WHERE status='settled'),0)::text AS cost_micros FROM reservations
      WHERE created_at>=$1 AND created_at<$2 GROUP BY 1 ORDER BY 1`, args),
    await db.query(`SELECT count(*)::int AS runs,count(*) FILTER (WHERE status='completed')::int AS completed,
      count(*) FILTER (WHERE status='failed')::int AS failed,count(*) FILTER (WHERE status='cancelled')::int AS cancelled
      FROM cloud_runs WHERE created_at>=$1 AND created_at<$2`, args),
    await db.query(`SELECT COALESCE(sum(actual_seconds) FILTER (WHERE status='settled'),0)::text AS settled_seconds,
      count(*) FILTER (WHERE status='active')::int AS unresolved FROM cloud_compute_reservations WHERE created_at>=$1 AND created_at<$2`, args),
    await db.query(`SELECT count(*)::int AS retained,count(*) FILTER (WHERE updated_at>=$1 AND updated_at<$2)::int AS updated
      FROM synced_conversations WHERE deleted_at IS NULL`, args),
    await db.query(`SELECT id,sponsor,active,impressions::text,clicks::text FROM campaigns ORDER BY created_at DESC LIMIT 50`),
    await db.query(`SELECT count(*)::int AS inquiries FROM sponsor_inquiries WHERE created_at>=$1 AND created_at<$2`, args),
    ];
  });
  const [accounts, ai, models, daily, runs, compute, conversations, campaigns, inquiries] = results;
  const inference = ai.rows[0];
  return {
    period: { days, from: from.toISOString(), to: now.toISOString(), timezone: "UTC" },
    accounts: accounts.rows[0],
    inference: { ...inference, costMicrosPerActiveAccount: inference.active_accounts && inference.unattributed_requests === 0 ? Number(inference.cost_micros) / inference.active_accounts : null },
    models: models.rows, daily: daily.rows, runs: runs.rows[0], compute: compute.rows[0], conversations: conversations.rows[0],
    advertising: { campaigns: campaigns.rows, inquiries: inquiries.rows[0].inquiries, scope: "Lifetime campaign counters; impression/click timestamps and advertiser revenue are not recorded." },
    unavailable: ["Vercel infrastructure billing and credits are not imported into this dashboard.", "Acquisition channels, visitors and conversion rates are not recorded.", "Advertiser prices, invoiced revenue and profit are not recorded."],
  };
}
