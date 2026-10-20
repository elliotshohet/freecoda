import { randomUUID } from "node:crypto";
import {
  DAILY_FREE_MICROS,
  MONTHLY_FREE_MICROS,
  utcDay,
  utcMonth,
  nextReset,
} from "@freecoda/contracts";
import { getPool, transaction } from "./db";
import { ApiError } from "./http";
import { PREFERRED_FREE_MODEL } from "./free-model-selector";

export function isVerifiedZeroCostFreeModel(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  return (
    config.approved === true &&
    config.id === PREFERRED_FREE_MODEL &&
    config.provider === "reflection" &&
    config.byok === false &&
    config.inputMicrosPerToken === 0 &&
    config.outputMicrosPerToken === 0
  );
}

export const MAX_CONCURRENT_ZERO_COST_RESERVATIONS = 3;

/** Reservation rows record the original zero-cost proof; never re-price them
 * from the current mutable catalog. Unknown values (including NULL) fail closed.
 * Nonzero/unknown-cost traffic retains its existing single-request admission.
 */
export function canAdmitUsageReservation(
  model: string,
  maxCostMicros: number,
  active: readonly {
    status: unknown;
    source: unknown;
    model: unknown;
    maxCostMicros: unknown;
  }[],
): boolean {
  if (!Number.isSafeInteger(maxCostMicros) || maxCostMicros < 0 ||
    (maxCostMicros === 0 && model !== PREFERRED_FREE_MODEL)) return false;
  if (active.length === 0) return true;
  return (
    active.length < MAX_CONCURRENT_ZERO_COST_RESERVATIONS &&
    model === PREFERRED_FREE_MODEL &&
    maxCostMicros === 0 &&
    active.every(row =>
      row.status === "pending" &&
      row.source === "free" &&
      row.model === PREFERRED_FREE_MODEL &&
      // pg returns bigint as a decimal string by default. Do not coerce null,
      // booleans, empty strings or malformed values into a zero-cost proof.
      (row.maxCostMicros === 0 || row.maxCostMicros === "0"),
    )
  );
}

export function canReleaseStaleFreeReservation(
  row: {
    status: unknown;
    source: unknown;
    model: unknown;
    generationId: unknown;
    maxCostMicros: unknown;
    createdAt: string | Date;
  },
  now = Date.now(),
) {
  const createdAt = new Date(row.createdAt).getTime();
  return (
    ["pending", "uncertain"].includes(String(row.status)) &&
    row.source === "free" &&
    row.model === PREFERRED_FREE_MODEL &&
    Number(row.maxCostMicros) === 0 &&
    Number.isFinite(createdAt) &&
    createdAt <= now - 5 * 60 * 1000
  );
}

export async function usageSnapshot(userId: string) {
  const { rows } = await getPool().query(
    'SELECT p.suspended,i.email FROM "user" u LEFT JOIN profiles p ON p.user_id=u.id LEFT JOIN invitations i ON lower(i.email)=lower(u.email) WHERE u.id=$1',
    [userId],
  );
  const invited = !!rows[0]?.email && !rows[0]?.suspended;
  const { rows: buckets } = await getPool().query(
    "SELECT scope,spent_micros,reserved_micros FROM usage_buckets WHERE (scope=$1 AND period=$2) OR (scope='global' AND period=$3)",
    [userId, utcDay(), utcMonth()],
  );
  const daily = buckets.find((r) => r.scope === userId);
  const global = buckets.find((r) => r.scope === "global");
  const free = Math.max(
    0,
    Math.min(
      DAILY_FREE_MICROS -
        Number(daily?.spent_micros || 0) -
        Number(daily?.reserved_micros || 0),
      MONTHLY_FREE_MICROS -
        Number(global?.spent_micros || 0) -
        Number(global?.reserved_micros || 0),
    ),
  );
  const devices = await getPool().query(
    'SELECT id,name,created_at AS "createdAt" FROM devices WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC',
    [userId],
  );
  return {
    freeRemainingMicros: invited ? free : 0,
    dailyLimitMicros: DAILY_FREE_MICROS,
    resetAt: nextReset(),
    invited,
    devices: devices.rows,
  };
}
export async function reserve(
  userId: string,
  model: string,
  maxCostMicros: number,
) {
  if (
    !Number.isSafeInteger(maxCostMicros) ||
    maxCostMicros < 0 ||
    (maxCostMicros === 0 && model !== PREFERRED_FREE_MODEL)
  )
    throw new Error("Invalid reservation amount");
  return transaction(async (db) => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('freecoda:free-budget'))",
    );
    // Zero-cost proof is captured at reservation time. Never infer it later
    // from a mutable model catalog when recovering a stale request.
    await db.query(
      "UPDATE reservations SET status='released',actual_cost_micros=0,settled_at=now() WHERE user_id=$1 AND status IN ('pending','uncertain') AND source='free' AND model=$2 AND max_cost_micros=0 AND created_at<=now()-interval '5 minutes'",
      [userId, PREFERRED_FREE_MODEL],
    );
    // Older Beam Free requests reserved a one-micro allowance floor. Preserve
    // that entire bound as spend rather than leaving an orphaned request
    // blocking the account forever or assuming its historical cost was zero.
    const legacy = await db.query(
      "UPDATE reservations SET status='settled',actual_cost_micros=max_cost_micros,settled_at=now() WHERE user_id=$1 AND status='uncertain' AND source='free' AND model=$2 AND max_cost_micros=1 AND generation_id IS NULL AND created_at<=now()-interval '5 minutes' RETURNING user_id,day,month,max_cost_micros",
      [userId, PREFERRED_FREE_MODEL],
    );
    for (const row of legacy.rows) await db.query(
      "UPDATE usage_buckets SET reserved_micros=reserved_micros-$4,spent_micros=spent_micros+$4 WHERE (scope=$1 AND period=$2) OR (scope='global' AND period=$3)",
      [row.user_id, row.day, row.month, row.max_cost_micros],
    );
    const day = utcDay(),
      month = utcMonth();
    const active = await db.query(
      "SELECT id,status,source,model,max_cost_micros AS \"maxCostMicros\" FROM reservations WHERE user_id=$1 AND status IN ('pending','uncertain') FOR UPDATE",
      [userId],
    );
    // Admission and insertion share the existing global budget advisory lock.
    // Lock these rows too so a concurrent uncertain transition cannot invalidate
    // the admission snapshot before this transaction has committed.
    if (!canAdmitUsageReservation(model, maxCostMicros, active.rows))
      throw new ApiError(
        409,
        `Another request is waiting for usage reconciliation, uses an unverified cost, or the limit of ${MAX_CONCURRENT_ZERO_COST_RESERVATIONS} simultaneous verified free requests has been reached.`,
      );
    await db.query(
      "INSERT INTO usage_buckets(scope,period) VALUES($1,$2),('global',$3) ON CONFLICT DO NOTHING",
      [userId, day, month],
    );
    const { rows } = await db.query(
      "SELECT * FROM usage_buckets WHERE (scope=$1 AND period=$2) OR (scope='global' AND period=$3) FOR UPDATE",
      [userId, day, month],
    );
    for (const bucket of rows) {
      const limit =
        bucket.scope === "global" ? MONTHLY_FREE_MICROS : DAILY_FREE_MICROS;
      if (
        Number(bucket.spent_micros) +
          Number(bucket.reserved_micros) +
          maxCostMicros >
        limit
      )
        throw new ApiError(
          429,
          bucket.scope === "global"
            ? "Hosted beta capacity is used up for this month. There is no paid upgrade."
            : "Your daily allowance is used up or too small for this request. Try a shorter task or return after midnight UTC.",
        );
    }
    const id = randomUUID();
    await db.query(
      "UPDATE usage_buckets SET reserved_micros=reserved_micros+$4 WHERE (scope=$1 AND period=$2) OR (scope='global' AND period=$3)",
      [userId, day, month, maxCostMicros],
    );
    await db.query(
      "INSERT INTO reservations(id,user_id,request_key,model,source,max_cost_micros,day,month) VALUES($1,$2,$1,$3,'free',$4,$5,$6)",
      [id, userId, model, maxCostMicros, day, month],
    );
    return id;
  });
}
export async function settle(
  id: string,
  costMicros: number,
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    generationId?: string;
  },
  release = false,
) {
  if (!Number.isSafeInteger(costMicros) || costMicros < 0)
    throw new Error("Invalid settled cost");
  return transaction(async (db) => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('freecoda:free-budget'))",
    );
    const { rows } = await db.query(
      "SELECT * FROM reservations WHERE id=$1 FOR UPDATE",
      [id],
    );
    const row = rows[0];
    if (!row || ["settled", "released"].includes(row.status)) return false;
    await db.query(
      "UPDATE usage_buckets SET reserved_micros=reserved_micros-$4,spent_micros=spent_micros+$5 WHERE (scope=$1 AND period=$2) OR (scope='global' AND period=$3)",
      [
        row.user_id || `deleted:${row.id}`,
        row.day,
        row.month,
        row.max_cost_micros,
        costMicros,
      ],
    );
    await db.query(
      "UPDATE reservations SET status=$2,actual_cost_micros=$3,input_tokens=$4,output_tokens=$5,generation_id=COALESCE($6,generation_id),settled_at=now() WHERE id=$1",
      [
        id,
        release ? "released" : "settled",
        costMicros,
        usage?.inputTokens,
        usage?.outputTokens,
        usage?.generationId,
      ],
    );
    return true;
  });
}
export async function uncertain(id: string, generationId?: string) {
  await getPool().query(
    "UPDATE reservations SET status='uncertain',generation_id=COALESCE($2,generation_id) WHERE id=$1 AND status='pending'",
    [id, generationId],
  );
}
