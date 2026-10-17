import { gateway } from "ai";
import { getPool } from "../apps/web/lib/db";
import { settle } from "../apps/web/lib/usage";
const { rows } = await getPool().query(
  "SELECT id,generation_id FROM reservations WHERE status IN ('uncertain','pending') AND created_at<now()-interval '3 minutes'",
);
for (const row of rows) {
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
