import { test, expect } from "bun:test";
import { rankFreeModels, zeroPricing, selectFreeModel } from "../apps/web/lib/free-model-selector";
const task = { tools: true, contextTokens: 12_000, outputTokens: 4096, kind: "coding" as const };
const model = (id: string) => ({ id, type: "language", context_window: 100_000, max_tokens: 8192, pricing: { input: "0", output: "0" }, tags: ["reasoning"], supported_parameters: ["tools"] });
const endpoint = (overrides = {}) => ({ provider_name: "test", context_length: 100_000, max_completion_tokens: 8192, pricing: { prompt: "0", completion: "0", request: "0", internal_reasoning: "0" }, status: 0, supported_parameters: ["tools"], ...overrides });
test("free selection excludes paid ancillary billing, unknown pricing, tools and context mismatches", () => {
  expect(zeroPricing({ prompt: "0", completion: "0", request: "0", internal_reasoning: "0.01" }, ["prompt", "completion", "request"])).toBe(false);
  expect(zeroPricing({ prompt: "", completion: "0", request: "0" }, ["prompt", "completion", "request"])).toBe(false);
  const entries = [endpoint({ pricing: { prompt: "0", completion: "0", request: "1" } }), endpoint({ supported_parameters: [] }), endpoint({ context_length: 100 }), endpoint({ status: 1 })];
  expect(rankFreeModels([model("test/a")], new Map([["test/a", entries]]), task)).toEqual([]);
});
test("ranking uses task fit, measured speed, privacy and deterministic ties", () => {
  const models = [model("test/b"), model("test/a")];
  const endpoints = new Map(models.map(m => [m.id, [endpoint()]]));
  expect(rankFreeModels(models, endpoints, task)[0].config.id).toBe("test/a");
  endpoints.set("test/b", [endpoint({ has_no_training: true, latency_last_1h: { p50: 100 } })]);
  const best = rankFreeModels(models, endpoints, task)[0];
  expect(best.config.id).toBe("test/b");
  expect(best.config.allowPromptTraining).toBe(false);
});
test("only exact evaluated providers remain eligible and changing prices fail closed", async () => {
  const m = model("test/a");
  const approved = [{ id: m.id, provider: "other", approved: true, inputMicrosPerToken: 0, outputMicrosPerToken: 0, maxContextTokens: 100000 }];
  expect(rankFreeModels([m], new Map([[m.id, [endpoint()]]]), task, approved)).toEqual([]);
  const fetcher = (async (url: string) => Response.json(url.endsWith("/endpoints") ? { data: { endpoints: [endpoint({ pricing: { prompt: "0", completion: "0.1", request: "0" } })] } } : { data: [m] })) as typeof fetch;
  await expect(selectFreeModel(task, undefined, fetcher, m.id)).rejects.toThrow("No evaluated free model");
});

test("production pins Beam even when another free candidate is faster", async () => {
  const other = model("test/faster");
  const beam = model("reflection/beam-free");
  const fetcher = (async (url: string) => Response.json(url.endsWith("/endpoints") ? { data: { endpoints: [endpoint()] } } : { data: [other, beam] })) as typeof fetch;
  const selected = await selectFreeModel(task, undefined, fetcher);
  expect(selected.config.id).toBe("reflection/beam-free");
});

test("missing Beam does not fall back to another free model", async () => {
  const fetcher = (async (_url: string) => Response.json({ data: [model("test/free-alternative")] })) as typeof fetch;
  await expect(selectFreeModel(task, undefined, fetcher)).rejects.toThrow("No evaluated free model");
});
test("malformed limits fail closed and evaluated context caps are respected", () => {
  const m = model("test/a");
  for (const invalid of [undefined, null, NaN, Infinity, -1, 0, 1.5, "100000"]) {
    expect(rankFreeModels([{ ...m, context_window: invalid } as any], new Map([[m.id, [endpoint()]]]), task)).toEqual([]);
    expect(rankFreeModels([m], new Map([[m.id, [endpoint({ context_length: invalid })]]]), task)).toEqual([]);
    expect(rankFreeModels([m], new Map([[m.id, [endpoint({ max_completion_tokens: invalid })]]]), task)).toEqual([]);
  }
  const approved = [{ id: m.id, provider: "test", approved: true, inputMicrosPerToken: 0, outputMicrosPerToken: 0, maxContextTokens: 10000 }];
  expect(rankFreeModels([m], new Map([[m.id, [endpoint()]]]), task, approved)).toEqual([]);
  for (const deprecated_at of [Date.now() - 1000, Math.floor(Date.now() / 1000) - 1])
    expect(rankFreeModels([{ ...m, deprecated_at }], new Map([[m.id, [endpoint()]]]), task)).toEqual([]);
});
