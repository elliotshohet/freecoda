import { getPool } from "../apps/web/lib/db";
import { z } from "zod";
const schema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      context_window: z.number().optional(),
      pricing: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});
const response = await fetch("https://ai-gateway.vercel.sh/v1/models");
if (!response.ok) throw new Error("Model discovery failed");
const data = schema.parse(await response.json());
const [modelId, provider] = process.argv.slice(2);
if (!modelId) {
  console.log(
    data.data
      .filter((m) => m.pricing?.input && m.pricing?.output)
      .map((m) => ({
        id: m.id,
        input: m.pricing?.input,
        output: m.pricing?.output,
      })),
  );
  process.exit(0);
}
if (!provider)
  throw new Error(
    "Usage: scripts/sync-models.ts <exact-model-id> <allowed-provider>",
  );
const model = data.data.find((m) => m.id === modelId);
if (!model?.pricing || !model.context_window)
  throw new Error("Model ID or pricing was not found in the live catalog.");
function maxRate(keys: string[]) {
  const values: number[] = [];
  for (const key of keys) {
    const value = model!.pricing![key];
    if (typeof value === "string" || typeof value === "number")
      values.push(Number(value));
    if (Array.isArray(value))
      for (const tier of value) {
        if (tier && typeof tier === "object" && "cost" in tier)
          values.push(Number(tier.cost));
      }
  }
  if (!values.length || values.some((v) => !Number.isFinite(v) || v < 0))
    throw new Error("Incomplete pricing.");
  return Math.max(...values) * 1e6;
}
const config = {
  id: model.id,
  provider,
  inputMicrosPerToken: maxRate([
    "input",
    "input_cache_read",
    "input_cache_write",
    "input_tiers",
    "input_cache_read_tiers",
    "input_cache_write_tiers",
  ]),
  outputMicrosPerToken: maxRate(["output", "output_tiers"]),
  maxContextTokens: model.context_window,
  approved: false,
};
await getPool().query(
  "INSERT INTO model_catalog(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=excluded.config",
  [config.id, config],
);
await getPool().end();
console.log(
  `Saved ${config.id} as unapproved. Run the evaluation harness before enabling hosted access.`,
);
