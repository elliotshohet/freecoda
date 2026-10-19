import type { ModelConfig } from "@freecoda/contracts";

export const PREFERRED_FREE_MODEL = "reflection/beam-free";

export type FreeModelTask = { tools: boolean; contextTokens: number; outputTokens: number; kind: "chat" | "coding" };
type CatalogModel = {
  id: string; type?: string; context_window: number; max_tokens?: number;
  pricing?: Record<string, unknown>; tags?: string[]; supported_parameters?: string[];
  deprecated_at?: number;
};
type Endpoint = {
  provider_name: string; context_length: number; max_completion_tokens?: number;
  pricing?: Record<string, unknown>; supported_parameters?: string[]; tags?: string[];
  has_no_training?: boolean; has_zdr?: boolean; status?: number;
  uptime_last_1h?: number; latency_last_1h?: { p50?: number }; throughput_last_1h?: { p50?: number };
};
export type FreeModelCandidate = { config: ModelConfig; score: number; reasons: string[] };
const zero = (v: unknown) => (typeof v === "string" && v.trim() !== "" || typeof v === "number") && Number(v) === 0;
export function zeroPricing(pricing: Record<string, unknown> | undefined, required: string[]) {
  if (!pricing || !required.every(key => zero(pricing[key]))) return false;
  // Reject unknown non-zero billing dimensions too; discount is not a charge.
  return Object.entries(pricing).every(([key, value]) => key === "discount" || value === false || zero(value));
}
export function rankFreeModels(models: CatalogModel[], endpoints: Map<string, Endpoint[]>, task: FreeModelTask, approved?: ModelConfig[], now = Date.now()): FreeModelCandidate[] {
  const result: FreeModelCandidate[] = [];
  const positiveInteger = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  if (![task.contextTokens, task.outputTokens].every(positiveInteger)) return result;
  for (const model of models) {
    const deprecatedAt = model.deprecated_at === undefined ? undefined :
      model.deprecated_at < 1e12 ? model.deprecated_at * 1000 : model.deprecated_at;
    if (model.type !== "language" ||
        !positiveInteger(model.context_window) || !positiveInteger(model.max_tokens) ||
        deprecatedAt !== undefined && (!positiveInteger(deprecatedAt) || deprecatedAt <= now) ||
        !zeroPricing(model.pricing, ["input", "output"])) continue;
    for (const endpoint of endpoints.get(model.id) || []) {
      const existing = approved?.find(c => c.approved && !c.byok && c.id === model.id && c.provider === endpoint.provider_name && c.inputMicrosPerToken === 0 && c.outputMicrosPerToken === 0);
      if (approved && !existing) continue;
      const maxContext = Math.min(model.context_window, endpoint.context_length, existing?.maxContextTokens ?? model.context_window);
      if (!positiveInteger(endpoint.context_length) ||
          !positiveInteger(endpoint.max_completion_tokens) ||
          existing && !positiveInteger(existing.maxContextTokens) ||
          !zeroPricing(endpoint.pricing, ["prompt", "completion", "request"]) ||
          endpoint.status !== undefined && endpoint.status !== 0 ||
          maxContext < task.contextTokens ||
          Math.min(endpoint.max_completion_tokens!, model.max_tokens!) < task.outputTokens ||
          task.tools && !endpoint.supported_parameters?.includes("tools")) continue;
      const parameters = endpoint.supported_parameters || [];
      const tags = new Set([...(model.tags || []), ...(endpoint.tags || [])]);
      const reasons = ["all published prices are zero", "context and output fit"];
      let score = 0;
      if (endpoint.has_no_training) { score += 20; reasons.push("no training"); }
      if (endpoint.has_zdr) { score += 10; reasons.push("zero retention"); }
      if (task.kind === "coding") {
        if (tags.has("reasoning")) { score += 15; reasons.push("reasoning"); }
        if (parameters.includes("tools")) score += 15;
        if (parameters.includes("structured_outputs")) score += 5;
        score += Math.min(10, model.context_window / 100_000);
      }
      const latency = endpoint.latency_last_1h?.p50;
      const throughput = endpoint.throughput_last_1h?.p50;
      // Missing telemetry is neutral. Measured fast endpoints rank above unknowns.
      if (latency !== undefined && Number.isFinite(latency) && latency >= 0) {
        score += (task.kind === "chat" ? 30 : 10) / (1 + latency / 1000);
        reasons.push(`p50 latency ${latency}ms`);
      }
      if (throughput !== undefined && Number.isFinite(throughput) && throughput >= 0)
        score += Math.min(task.kind === "coding" ? 15 : 5, throughput / 10);
      if (endpoint.uptime_last_1h !== undefined && Number.isFinite(endpoint.uptime_last_1h))
        score += Math.max(-20, Math.min(5, (endpoint.uptime_last_1h - 99) * 5));
      result.push({ config: {
        id: model.id, provider: endpoint.provider_name, byok: false,
        inputMicrosPerToken: 0, outputMicrosPerToken: 0,
        maxContextTokens: maxContext,
        approved: existing?.approved ?? false,
        allowPromptTraining: !endpoint.has_no_training,
      }, score, reasons });
    }
  }
  return result.sort((a,b) => b.score - a.score || a.config.id.localeCompare(b.config.id) || a.config.provider.localeCompare(b.config.provider));
}
export async function selectFreeModel(task: FreeModelTask, approved?: ModelConfig[], fetcher: typeof fetch = fetch, modelId = PREFERRED_FREE_MODEL) {
  const response = await fetcher("https://ai-gateway.vercel.sh/v1/models", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Cannot verify current free model pricing.");
  const { data } = await response.json() as { data: CatalogModel[] };
  const shortlist = data.filter(m => m.id === modelId && m.type === "language" && zeroPricing(m.pricing, ["input", "output"]) && (!approved || approved.some(c => c.approved && !c.byok && c.id === m.id)));
  const endpointResults = await Promise.all(shortlist.map(async m => {
    try {
      const response = await fetcher(`https://ai-gateway.vercel.sh/v1/models/${m.id}/endpoints`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return [m.id, [] as Endpoint[]] as const;
      return [m.id, (await response.json()).data.endpoints as Endpoint[]] as const;
    } catch { return [m.id, [] as Endpoint[]] as const; }
  }));
  const ranked = rankFreeModels(shortlist, new Map(endpointResults), task, approved);
  if (!ranked.length) throw new Error("No evaluated free model currently meets this request. No paid fallback is allowed.");
  return ranked[0];
}
