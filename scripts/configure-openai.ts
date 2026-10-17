import { readFile } from "node:fs/promises";
import { getPool } from "../apps/web/lib/db";
import {
  GATEWAY_OPENAI_MODEL,
  OPENAI_INPUT_RATE,
  OPENAI_OUTPUT_RATE,
} from "../apps/web/lib/hosted-provider";

const approve = process.argv.includes("--approve");
if (approve) {
  const report = JSON.parse(await readFile(".data/evaluation.json", "utf8"));
  if (
    !report.passed ||
    !report.fullSuitePassed ||
    !report.byok ||
    report.provider !== "openai" ||
    report.modelId !== GATEWAY_OPENAI_MODEL ||
    report.results?.length !== 12 ||
    !report.results.every((r: { passed?: boolean }) => r.passed)
  ) {
    throw new Error(
      "Approval requires a passing twelve-fixture evaluation for this exact OpenAI model.",
    );
  }
  const age = Date.now() - Date.parse(report.evaluatedAt);
  if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000)
    throw new Error("Run a fresh evaluation before approval.");
}
const config = {
  id: GATEWAY_OPENAI_MODEL,
  provider: "openai",
  byok: true,
  inputMicrosPerToken: OPENAI_INPUT_RATE,
  outputMicrosPerToken: OPENAI_OUTPUT_RATE,
  maxContextTokens: 400_000,
  approved: approve,
};
try {
  await getPool().query(
    "INSERT INTO model_catalog(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=excluded.config",
    [config.id, config],
  );
  console.log(
    `Saved ${config.id}; approved=${approve}. Hosted enablement remains a separate setting.`,
  );
} finally {
  await getPool().end();
}
