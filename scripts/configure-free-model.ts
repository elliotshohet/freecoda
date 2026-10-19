import { readFile } from "node:fs/promises";
import { getPool } from "../apps/web/lib/db";
import { selectFreeModel, PREFERRED_FREE_MODEL } from "../apps/web/lib/free-model-selector";
const modelIndex = process.argv.indexOf("--model");
const requestedModel = modelIndex >= 0 ? process.argv[modelIndex + 1] : PREFERRED_FREE_MODEL;
if (requestedModel !== PREFERRED_FREE_MODEL) throw new Error("This deployment is pinned to reflection/beam-free; no alternate model is allowed.");
const selection = await selectFreeModel({ tools: true, kind: "coding", contextTokens: 16_384, outputTokens: 4096 });
const { id: modelId, provider } = selection.config;
console.log(JSON.stringify({ selected: modelId, provider, score: selection.score, reasons: selection.reasons }));
if (process.argv.includes("--discover")) process.exit(0);
const approve = process.argv.includes("--approve");
if (approve) {
  const report = JSON.parse(await readFile(".data/evaluation.json", "utf8"));
  const age = Date.now() - Date.parse(report.evaluatedAt);
  if (!report.passed || !report.fullSuitePassed || report.byok ||
      report.modelId !== modelId || report.provider !== provider ||
      report.results?.length !== 12 || !report.results.every((r: { passed?: boolean }) => r.passed) ||
      report.pricing?.inputUsdPerToken !== 0 || report.pricing?.outputUsdPerToken !== 0 ||
      !Number.isFinite(age) || age < 0 || age > 86_400_000)
    throw new Error("Approval requires a fresh passing twelve-fixture evaluation for this exact free model.");
}
const config = { ...selection.config, approved: approve };
try {
  // Replace previous defaults atomically so no paid model remains selectable.
  await getPool().query(`WITH disabled AS (
    UPDATE model_catalog SET config=jsonb_set(config,'{approved}','false') WHERE id<>$1
  ) INSERT INTO model_catalog(id,config) VALUES($1,$2)
    ON CONFLICT(id) DO UPDATE SET config=excluded.config`, [config.id, config]);
  console.log(`Saved ${config.id}; approved=${approve}. No paid fallback. Provider may retain prompts and use them for training.`);
} finally {
  await getPool().end();
}
