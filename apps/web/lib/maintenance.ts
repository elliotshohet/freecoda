import { createHash, timingSafeEqual } from "node:crypto";
import { getPool } from "./db";
import { cleanupExpired } from "./security";
import { ApiError, handle, json } from "./http";
export function authorizeMaintenance(req: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = req.headers.get("authorization") || "";
  if (
    !secret ||
    secret.length < 32 ||
    !timingSafeEqual(
      createHash("sha256").update(supplied).digest(),
      createHash("sha256").update(`Bearer ${secret}`).digest(),
    )
  )
    throw new ApiError(401, "Maintenance authorization required.");
}
type Tasks = {
  cleanup(): Promise<void>;
  reconcile(row: { id: string; generation_id: string }): Promise<void>;
  project(id: string): Promise<void>;
  account(id: string): Promise<void>;
};
const productionTasks: Tasks = {
  cleanup: cleanupExpired,
  async reconcile(row) {
    const { createGateway } = await import("ai");
    const gateway = createGateway({
      fetch: ((input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            AbortSignal.timeout(20_000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        })) as typeof fetch,
    });
    const { settle } = await import("./usage");
    const info = await gateway.getGenerationInfo({ id: row.generation_id });
    if (!Number.isFinite(info.totalCost) || info.totalCost < 0)
      throw new Error("Missing usage evidence");
    await settle(row.id, Math.ceil(info.totalCost * 1e6), {
      inputTokens: info.promptTokens,
      outputTokens: info.completionTokens,
      generationId: info.id,
    });
  },
  async project(id) {
    const { scheduleProjectLifecycle } = await import("./cloud/lifecycle");
    await scheduleProjectLifecycle(id);
  },
  async account(id) {
    const { start } = await import("workflow/api");
    const { cloudAccountCleanup } = await import("./cloud/lifecycle");
    await start(cloudAccountCleanup, [id]);
  },
};
/** Daily Hobby-compatible sweep. Durable workflows do external resource retries. */
export async function runMaintenance(tasks: Tasks = productionTasks) {
  const client = await getPool().connect();
  const counts = {
    cleaned: 0,
    reconciled: 0,
    manualReview: 0,
    projectsScheduled: 0,
    accountsScheduled: 0,
    failures: 0,
  };
  let locked = false;
  const deadline = Date.now() + 100_000;
  try {
    locked = (
      await client.query(
        "SELECT pg_try_advisory_lock(hashtext('freecoda-maintenance')) AS acquired",
      )
    ).rows[0].acquired;
    if (!locked) return { status: "busy" as const, counts };
    await client.query(
      "INSERT INTO maintenance_status(id,started_at,status,counts) VALUES('daily',now(),'running','{}') ON CONFLICT(id) DO UPDATE SET started_at=now(),finished_at=NULL,status='running',counts='{}'",
    );
    const attempt = async (
      work: () => Promise<void>,
      success: keyof typeof counts,
    ) => {
      try {
        await work();
        counts[success]++;
      } catch {
        counts.failures++;
      }
    };
    await attempt(tasks.cleanup, "cleaned");
    const reservations = (
      await client.query(
        "SELECT r.id,r.generation_id,m.config FROM reservations r LEFT JOIN model_catalog m ON m.id=r.model WHERE r.status IN('pending','uncertain') AND r.created_at<now()-interval '5 minutes' ORDER BY r.created_at LIMIT 5",
      )
    ).rows;
    for (const row of reservations) {
      if (Date.now() > deadline) break;
      // Gateway may bill zero for BYOK while the upstream bills separately.
      // Missing/unknown config is never evidence of a zero-cost request.
      if (!row.generation_id || !row.config || row.config.byok !== false) {
        counts.manualReview++;
        continue;
      }
      await attempt(() => tasks.reconcile(row), "reconciled");
    }
    const projects = (
      await client.query(
        "SELECT id FROM cloud_projects WHERE status='deleted' OR expires_at<=now() OR lifecycle_workflow_id IS NULL ORDER BY expires_at LIMIT 20",
      )
    ).rows;
    for (const row of projects) {
      if (Date.now() > deadline) break;
      await attempt(() => tasks.project(row.id), "projectsScheduled");
    }
    const accounts = (
      await client.query(
        "SELECT id FROM cloud_resource_cleanup ORDER BY created_at LIMIT 20",
      )
    ).rows;
    for (const row of accounts) {
      if (Date.now() > deadline) break;
      await attempt(() => tasks.account(row.id), "accountsScheduled");
    }
    const status = counts.failures ? ("failed" as const) : ("ok" as const);
    await client.query(
      "UPDATE maintenance_status SET finished_at=now(),status=$1,counts=$2 WHERE id='daily'",
      [status, JSON.stringify(counts)],
    );
    return { status, counts };
  } finally {
    if (locked)
      await client
        .query("SELECT pg_advisory_unlock(hashtext('freecoda-maintenance'))")
        .catch(() => {});
    client.release();
  }
}
export async function maintenanceRoute(req: Request) {
  return handle(async () => {
    authorizeMaintenance(req);
    if (
      req.method === "GET" &&
      new URL(req.url).searchParams.get("status") === "1"
    ) {
      const result = await getPool().query(
        "SELECT started_at,finished_at,status,counts FROM maintenance_status WHERE id='daily'",
      );
      return json({ maintenance: result.rows[0] || null });
    }
    const result = await runMaintenance();
    return json(result, result.status === "failed" ? 503 : 200);
  });
}
