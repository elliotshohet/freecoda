import { z } from "zod";
export * from "./conversation-commands";
export const DAILY_FREE_MICROS = 100_000;
export const MONTHLY_FREE_MICROS = 62_000_000;
export const MAX_REQUEST_BYTES = 100_000;
export const deviceStartSchema = z
  .object({ name: z.string().trim().min(1).max(80) })
  .strict();
export const devicePollSchema = z
  .object({ deviceCode: z.string().min(32).max(100) })
  .strict();
export const deviceApproveSchema = z
  .object({ code: z.string().regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/) })
  .strict();
export const inferenceSchema = z
  .object({
    model: z.string().min(1).max(150),
    messages: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
    tools: z.array(z.record(z.string(), z.unknown())).max(32).optional(),
    tool_choice: z.unknown().optional(),
    stream: z.boolean().default(true),
    stream_options: z
      .object({ include_usage: z.boolean().optional() })
      .optional(),
    max_tokens: z.number().int().min(1).max(4096).optional(),
    max_completion_tokens: z.number().int().min(1).max(4096).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();
export type ModelConfig = {
  id: string;
  provider: string;
  byok?: boolean;
  allowPromptTraining?: boolean;
  inputMicrosPerToken: number;
  outputMicrosPerToken: number;
  maxContextTokens: number;
  approved: boolean;
};
export type UsageSnapshot = { freeRemainingMicros: number; resetAt: string };
export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
export function utcMonth(date = new Date()) {
  return date.toISOString().slice(0, 7);
}
export function nextReset(date = new Date()) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
  ).toISOString();
}
export const modelCallSchema = z
  .object({
    protocol: z.literal(1),
    operation: z.enum(["stream", "generate"]),
    model: z.string().min(1).max(150),
    options: z
      .object({
        prompt: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
        tools: z.array(z.record(z.string(), z.unknown())).max(32).optional(),
        toolChoice: z.unknown().optional(),
        maxOutputTokens: z.number().int().min(1).max(4096).optional(),
        temperature: z.number().min(0).max(2).optional(),
        topP: z.number().min(0).max(1).optional(),
        topK: z.number().int().optional(),
        frequencyPenalty: z.number().optional(),
        presencePenalty: z.number().optional(),
        stopSequences: z.array(z.string()).optional(),
        responseFormat: z.unknown().optional(),
        seed: z.number().optional(),
        reasoning: z.unknown().optional(),
        providerOptions: z.unknown().optional(),
        includeRawChunks: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
export const sponsorInquirySchema = z
  .object({
    business: z.string().trim().min(2).max(100),
    email: z.email().max(200),
    website: z
      .url()
      .max(500)
      .refine((v) => new URL(v).protocol === "https:", "Use HTTPS"),
    message: z.string().trim().min(10).max(2000),
    companyUrl: z.string().max(500).optional(),
  })
  .strict();
export * from "./github-repositories";
export * from "./extensions";
export * from "./conversations";
