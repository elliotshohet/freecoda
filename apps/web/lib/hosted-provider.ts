import { createGateway } from "ai";
import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import type { ModelConfig } from "@freecoda/contracts";
import { ApiError } from "./http";
import { gatewayConfigured } from "./config";

// Verified against https://ai-gateway.vercel.sh/v1/models.
// USD per million tokens equals micro-USD per token.
export const GATEWAY_OPENAI_MODEL = "openai/gpt-5-mini";
export const OPENAI_INPUT_RATE = 0.25;
export const OPENAI_OUTPUT_RATE = 2;

export function hostedProviderModel(
  config: ModelConfig,
  fetch?: typeof globalThis.fetch,
) {
  if (!gatewayConfigured())
    throw new ApiError(503, "AI Gateway authentication is not configured.");
  if (
    config.byok &&
    (config.provider !== "openai" || !process.env.OPENAI_API_KEY)
  )
    throw new ApiError(503, "The hosted provider credentials are unavailable.");
  if (
    config.byok &&
    (config.id !== GATEWAY_OPENAI_MODEL ||
      config.inputMicrosPerToken !== OPENAI_INPUT_RATE ||
      config.outputMicrosPerToken !== OPENAI_OUTPUT_RATE ||
      !Number.isSafeInteger(config.maxContextTokens) ||
      config.maxContextTokens <= 0 ||
      config.maxContextTokens > 400_000)
  )
    throw new ApiError(503, "The hosted model configuration needs review.");
  // Every hosted request goes through Gateway; provider keys are only BYOK
  // options and can never become direct provider authentication.
  return createGateway({
    baseURL: "https://ai-gateway.vercel.sh/v4/ai",
    fetch,
  })(config.id);
}

export function gatewayProviderOptions(config: ModelConfig) {
  if (
    config.byok &&
    (config.provider !== "openai" || !process.env.OPENAI_API_KEY)
  )
    throw new ApiError(503, "The hosted provider credentials are unavailable.");
  return {
    gateway: {
      only: [config.provider],
      disallowPromptTraining: true,
      user: "freecoda",
      tags: ["freecoda", "sponsor-supported"],
      ...(config.byok
        ? { byok: { openai: [{ apiKey: process.env.OPENAI_API_KEY! }] } }
        : {}),
    },
    ...(config.provider === "openai"
      ? {
          openai: {
            store: false,
            reasoningEffort: "minimal",
            reasoningSummary: null,
            serviceTier: "default",
          },
        }
      : {}),
  };
}

type UsageResult = {
  usage: LanguageModelV4Usage;
  providerMetadata?: Record<string, unknown>;
};
const validCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export function generationAccounting(result: UsageResult, config: ModelConfig) {
  const metadata = result.providerMetadata?.gateway as
    Record<string, unknown> | undefined;
  const generationId =
    typeof metadata?.generationId === "string"
      ? metadata.generationId
      : undefined;
  const raw = metadata?.cost;
  const dollars =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : NaN;
  const gatewayCost = Math.ceil(dollars * 1e6);
  if (!Number.isSafeInteger(gatewayCost) || gatewayCost < 0)
    return { cost: undefined, generationId };
  if (!config.byok) return { cost: gatewayCost, generationId };
  const input = result.usage.inputTokens,
    output = result.usage.outputTokens;
  // Gateway may report zero because BYOK bills the provider separately.
  // Require complete usage and count cached input at full rate, with reasoning
  // included in total output; unknown usage keeps the original reservation.
  if (!validCount(input.total) || !validCount(output.total))
    return { cost: undefined, generationId };
  for (const value of [input.noCache, input.cacheRead, input.cacheWrite])
    if (value !== undefined && (!validCount(value) || value > input.total))
      return { cost: undefined, generationId };
  for (const value of [output.text, output.reasoning])
    if (value !== undefined && (!validCount(value) || value > output.total))
      return { cost: undefined, generationId };
  if (
    (input.noCache ?? 0) + (input.cacheRead ?? 0) + (input.cacheWrite ?? 0) >
      input.total ||
    (output.text ?? 0) + (output.reasoning ?? 0) > output.total
  )
    return { cost: undefined, generationId };
  const estimate = Math.ceil(
    input.total * config.inputMicrosPerToken +
      output.total * config.outputMicrosPerToken,
  );
  return {
    cost: validCount(estimate) ? Math.max(gatewayCost, estimate) : undefined,
    generationId,
  };
}

// The SDK's raw request body contains request-scoped credentials. It must never
// cross the hosted API boundary, including if a provider echoes its options.
export function sanitizeProviderResult(value: unknown): unknown {
  const key = process.env.OPENAI_API_KEY;
  if (typeof value === "string")
    return key ? value.split(key).join("[redacted credential]") : value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(sanitizeProviderResult);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([name]) => !["request", "headers", "byok", "apiKey"].includes(name),
        )
        .map(([name, item]) => [name, sanitizeProviderResult(item)]),
    );
  return value;
}
