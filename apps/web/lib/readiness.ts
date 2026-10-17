import { getPool } from "./db";
import type { Pool, PoolClient } from "pg";
/** No identities, tokens, provider calls or application payloads are queried. */
export async function databaseReadiness(
  pool: Pool = getPool(),
): Promise<boolean> {
  let client: PoolClient | undefined;
  let failed = false;
  try {
    client = await pool.connect();
    const query = {
      text: "SELECT 1 AS database_ready,coalesce((SELECT status='ok' AND finished_at IS NOT NULL AND started_at<=finished_at AND finished_at<=now() AND finished_at>=now()-interval '48 hours' FROM maintenance_status WHERE id='daily'),false) AS maintenance_ready",
      query_timeout: 2500,
    };
    const result = await client.query(query);
    return (
      result.rows[0]?.database_ready === 1 &&
      result.rows[0]?.maintenance_ready === true
    );
  } catch {
    failed = true;
    return false;
  } finally {
    client?.release(failed);
  }
}
/** Coalesce simultaneous public requests and bound per-instance probe load. */
export function createReadinessHandler(
  probe: () => Promise<boolean> = databaseReadiness,
  clock: () => number = Date.now,
) {
  let cached: { ready: boolean; expires: number } | undefined;
  let checking: Promise<boolean> | undefined;
  return async function readinessRoute() {
    if (!cached || clock() >= cached.expires) {
      if (!checking)
        checking = probe()
          .catch(() => false)
          .then((ready) => {
            cached = { ready, expires: clock() + 10000 };
            return ready;
          })
          .finally(() => {
            checking = undefined;
          });
      await checking;
    }
    const ready = cached?.ready === true;
    return Response.json(
      { ready },
      {
        status: ready ? 200 : 503,
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=10, must-revalidate",
          "Vercel-CDN-Cache-Control": "public, s-maxage=10",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  };
}
export const readinessRoute = createReadinessHandler();
