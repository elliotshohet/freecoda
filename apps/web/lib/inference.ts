import {
  hostedProviderModel,
  generationAccounting,
  gatewayProviderOptions,
  sanitizeProviderResult,
} from "./hosted-provider";
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { modelCallSchema, type ModelConfig } from "@freecoda/contracts";
import { getPool } from "./db";
import { jsonBody, ApiError, json } from "./http";
import { identity, requireInvite, rateLimit } from "./security";
import { reserve, settle, uncertain } from "./usage";
import { publicConfig } from "./config";
function stripProviderOptions(value: unknown): unknown {
  // Trusted SDK calls carry a live signal. Recursing through it would turn
  // it into {}, which fetch rejects before sending the model request.
  if (value instanceof AbortSignal) return value;
  if (Array.isArray(value)) return value.map(stripProviderOptions);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["providerOptions", "headers"].includes(key))
        .map(([k, v]) => [k, stripProviderOptions(v)]),
    );
  return value;
}
export function safeModelOptions(
  raw: Record<string, unknown>,
  config: ModelConfig,
): LanguageModelV4CallOptions {
  const cleaned = stripProviderOptions(raw) as Record<string, unknown>;
  const prompt = cleaned.prompt;
  if (!Array.isArray(prompt)) throw new ApiError(400, "Invalid prompt.");
  for (const message of prompt) {
    if (
      !message ||
      typeof message !== "object" ||
      !["system", "user", "assistant", "tool"].includes(message.role)
    )
      throw new ApiError(400, "Invalid message role.");
    if (typeof message.content === "string") {
      if (message.role !== "system")
        throw new ApiError(400, "Expected text message parts.");
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (
          !part ||
          ![
            "text",
            "reasoning",
            "tool-call",
            "tool-result",
            "tool-approval-response",
          ].includes(part.type)
        )
          throw new ApiError(
            400,
            "Only text and local tool context are supported.",
          );
        if (part.type === "tool-result") {
          const output = part.output;
          if (
            !output ||
            typeof output !== "object" ||
            ![
              "text",
              "json",
              "error-text",
              "error-json",
              "execution-denied",
              "content",
            ].includes(output.type)
          )
            throw new ApiError(400, "Invalid tool result.");
          if (
            output.type === "content" &&
            (!Array.isArray(output.value) ||
              output.value.some(
                (item: unknown) =>
                  !item ||
                  typeof item !== "object" ||
                  (item as Record<string, unknown>).type !== "text",
              ))
          )
            throw new ApiError(400, "Only text tool results are supported.");
        }
      }
    } else throw new ApiError(400, "Invalid message content.");
  }
  // Gateway may emit an empty reasoning placeholder without reusable provider
  // metadata. Exclude only that placeholder when replaying assistant history.
  cleaned.prompt = prompt.flatMap((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content))
      return [message];
    const content = message.content.filter(
      (part: { type: string; text?: string }) =>
        !(part.type === "reasoning" && part.text === ""),
    );
    return content.length ? [{ ...message, content }] : [];
  });
  if (!(cleaned.prompt as unknown[]).length)
    throw new ApiError(400, "Invalid prompt.");
  if (
    Array.isArray(cleaned.tools) &&
    cleaned.tools.some(
      (t) =>
        !t ||
        typeof t !== "object" ||
        (t as Record<string, unknown>).type !== "function",
    )
  )
    throw new ApiError(400, "Only local function tools are supported.");
  return {
    ...cleaned,
    maxOutputTokens: Number(cleaned.maxOutputTokens || 4096),
    providerOptions: gatewayProviderOptions(config),
  } as unknown as LanguageModelV4CallOptions;
}
export function maxRequestCost(
  config: ModelConfig,
  bytes: number,
  maxOutput: number,
) {
  const inputBound = bytes + 8192;
  if (inputBound + maxOutput > config.maxContextTokens)
    throw new ApiError(
      413,
      "This conversation is too large. Start a new conversation.",
    );
  return Math.max(
    1,
    Math.ceil(
      inputBound * config.inputMicrosPerToken +
        maxOutput * config.outputMicrosPerToken,
    ),
  );
}
export async function inference(req: Request) {
  if (!publicConfig().hostedEnabled || !publicConfig().inference)
    throw new ApiError(
      503,
      "Hosted AI is closed until funding, model evaluation, and privacy checks pass.",
    );
  const user = await identity(req);
  if (!user.device)
    throw new ApiError(
      403,
      "Hosted inference requires an authorized CLI device.",
    );
  await requireInvite(user.id);
  await rateLimit(`inference:${user.id}`, 30, 60);
  const body = await jsonBody(req, modelCallSchema);
  const { rows } = await getPool().query(
    "SELECT config FROM model_catalog WHERE id=$1",
    [body.model],
  );
  const config = rows[0]?.config as ModelConfig | undefined;
  if (!config?.approved)
    throw new ApiError(503, "This model has not passed launch checks.");
  const options = safeModelOptions(body.options, config);
  const bytes = Buffer.byteLength(JSON.stringify(options));
  const maximum = maxRequestCost(config, bytes, options.maxOutputTokens!);
  const model = hostedProviderModel(config);
  const reservation = await reserve(user.id, config.id, maximum);
  const timeout = AbortSignal.timeout(105000);
  options.abortSignal = timeout;
  let generationId: string | undefined;
  async function record(
    result:
      | LanguageModelV4GenerateResult
      | Extract<LanguageModelV4StreamPart, { type: "finish" }>,
  ) {
    const meta = generationAccounting(result, config!);
    generationId = meta.generationId || generationId;
    if (meta.cost === undefined) {
      await uncertain(reservation, generationId);
      throw new Error("Usage is awaiting reconciliation.");
    }
    await settle(reservation, meta.cost, {
      inputTokens: result.usage.inputTokens.total,
      outputTokens: result.usage.outputTokens.total,
      generationId,
    });
  }
  try {
    if (body.operation === "generate") {
      const result = await model.doGenerate(options);
      await record(result);
      const { request: ignoredRequest, response, ...safe } = result;
      return json(
        sanitizeProviderResult({
          ...safe,
          response: response
            ? {
                id: response.id,
                modelId: response.modelId,
                timestamp: response.timestamp,
              }
            : undefined,
        }),
      );
    }
    const result = await model.doStream(options);
    let cancelled = false;
    let finished = false;
    const reader = result.stream.getReader();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value.type === "response-metadata" && value.id)
              generationId = value.id;
            if (value.type === "finish") {
              await record(value);
              finished = true;
            }
            if (value.type === "error")
              throw new Error("Model provider returned an error.");
            if (value.type === "raw") continue;
            if (!cancelled)
              controller.enqueue(
                encoder.encode(
                  JSON.stringify(sanitizeProviderResult(value)) + "\n",
                ),
              );
          }
          if (!finished)
            throw new Error("Provider stream ended without usage.");
          if (!cancelled) controller.close();
        } catch {
          await uncertain(reservation, generationId);
          if (!cancelled) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "error",
                  error:
                    "Request interrupted. Usage is awaiting reconciliation; no additional request can spend this allowance until it is resolved.",
                }) + "\n",
              ),
            );
            controller.close();
          }
        }
      },
      cancel() {
        cancelled = true; /* Keep draining provider usage until settlement or timeout. */
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    await uncertain(reservation, generationId);
    throw e;
  }
}
