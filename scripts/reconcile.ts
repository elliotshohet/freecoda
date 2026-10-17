import { gateway } from "ai";
import { getPool } from "../apps/web/lib/db";
import { settle } from "../apps/web/lib/usage";
const { rows } = await getPool().query(
  "SELECT r.id,r.generation_id,m.config FROM reservations r LEFT JOIN model_catalog m ON m.id=r.model WHERE r.status IN ('uncertain','pending') AND r.created_at<now()-interval '3 minutes'",
);
for (const row of rows) {
  if (row.config?.byok) {
    console.log(
      `${row.id}: BYOK usage requires upstream provider billing evidence; reservation retained.`,
    );
    continue;
  }
  if (!row.generation_id) {
    console.log(`${row.id}: no provider generation ID; reservation retained.`);
    continue;
  }
  try {
    const info = await gateway.getGenerationInfo({ id: row.generation_id });
    if (!Number.isFinite(info.totalCost) || info.totalCost < 0)
      throw new Error();
    await settle(row.id, Math.ceil(info.totalCost * 1e6), {
      inputTokens: info.promptTokens,
      outputTokens: info.completionTokens,
      generationId: info.id,
    });
    console.log(`${row.id}: reconciled.`);
  } catch {
    console.log(
      `${row.id}: provider usage not available; reservation retained.`,
    );
  }
}
await getPool().end();
