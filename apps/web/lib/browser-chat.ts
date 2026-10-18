import { z } from "zod";
import { sessionUser } from "./auth";
import { sameOrigin, jsonBody, json, ApiError } from "./http";
import { publicConfig } from "./config";
import { hostedProviderModel } from "./hosted-provider";
import { getPool } from "./db";
import { requireInvite } from "./security";
import { executeInference } from "./inference";
import type { ModelConfig } from "@freecoda/contracts";
export const browserChatSchema = z
  .object({
    consent: z.literal(true),
    model: z.string().min(1).max(150).optional(),
    expectedUserId: z.string().min(1).max(200).optional(),
    messages: z
      .array(
        z.discriminatedUnion("role", [
          z
            .object({
              role: z.literal("user"),
              content: z.string().trim().min(1).max(8000),
            })
            .strict(),
          z
            .object({
              role: z.literal("assistant"),
              content: z.string().trim().min(1).max(64000),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(40),
  })
  .strict()
  .refine((b) => b.messages.at(-1)?.role === "user");
export function browserModelOptions(
  messages: { role: "user" | "assistant"; content: string }[],
) {
  return {
    maxOutputTokens: 4096,
    prompt: [
      {
        role: "system",
        content:
          "You are Freecoda, a helpful, candid assistant. Answer the user clearly and accurately. You have no tools, web browsing, file access, or ability to take actions. Do not claim to have performed actions or checked current external information. Explain uncertainty when relevant.",
      },
      ...messages.map((m) => ({
        role: m.role,
        content: [{ type: "text", text: m.content }],
      })),
    ],
  };
}
async function models() {
  const { rows } = await getPool().query(
    "SELECT config FROM model_catalog ORDER BY id",
  );
  return rows.map((r) => r.config as ModelConfig).filter((c) => c?.approved);
}
export function eligibleChatModels(approved: ModelConfig[]) {
  return approved.filter((c) => {
    if (!c.approved) return false;
    try {
      hostedProviderModel(c);
      return true;
    } catch {
      return false;
    }
  });
}
export async function browserChatStatus(req: Request) {
  const user = await sessionUser(req);
  if (!user)
    return json({
      signedIn: false,
      available: false,
      reason: "Sign in to chat.",
      models: [],
    });
  try {
    await requireInvite(user.id);
  } catch (e) {
    if (e instanceof ApiError)
      return json({
        signedIn: true,
        userId: user.id,
        available: false,
        reason: e.message,
        models: [],
      });
    throw e;
  }
  const approved = await models(),
    config = publicConfig();
  const eligible = eligibleChatModels(approved);
  const available =
    config.hostedEnabled && config.inference && eligible.length > 0;
  return json({
    signedIn: true,
    userId: user.id,
    available,
    reason: !config.hostedEnabled
      ? "Hosted chat is currently paused."
      : !config.inference
        ? "The hosted chat provider connection is not configured."
        : !eligible.length
          ? "No approved, configured chat model is available."
          : undefined,
    models: eligible.map((c) => ({ id: c.id, name: c.id })),
  });
}
export async function browserChat(
  req: Request,
  dependencies: {
    session?: (req: Request) => Promise<{ id: string } | null>;
    catalog?: () => Promise<ModelConfig[]>;
    infer?: typeof executeInference;
  } = {},
) {
  sameOrigin(req);
  const user = await (dependencies.session || sessionUser)(req);
  if (!user) throw new ApiError(401, "Sign in to chat.");
  const body = await jsonBody(req, browserChatSchema, 100_000);
  if (body.expectedUserId !== undefined && body.expectedUserId !== user.id)
    throw new ApiError(
      409,
      "Your signed-in account changed. Reload before sending this conversation.",
    );
  const approved = eligibleChatModels(await (dependencies.catalog || models)());
  const model = body.model
    ? approved.find((c) => c.id === body.model)
    : approved[0];
  if (!model) throw new ApiError(503, "No approved chat model is available.");
  const mapped = new Request(req.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: req.signal,
    body: JSON.stringify({
      protocol: 1,
      model: model.id,
      operation: "stream",
      options: browserModelOptions(body.messages),
    }),
  });
  const response = await (dependencies.infer || executeInference)(
    mapped,
    {
      id: user.id,
    },
    { abortOnDisconnect: true },
  );
  if (!response.body) throw new ApiError(503, "Chat stream is unavailable.");
  const decoder = new TextDecoder(),
    encoder = new TextEncoder();
  let pending = "";
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = pending.indexOf("\n")) >= 0) {
          const raw = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (raw) {
            const item = publicChatPart(JSON.parse(raw));
            if (item)
              controller.enqueue(encoder.encode(JSON.stringify(item) + "\n"));
          }
        }
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending.trim()) {
          const item = publicChatPart(JSON.parse(pending));
          if (item)
            controller.enqueue(encoder.encode(JSON.stringify(item) + "\n"));
        }
      },
    }),
  );
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
export function publicChatPart(value: Record<string, any>) {
  if (value.type === "text-delta" && typeof value.delta === "string")
    return { type: "text-delta", text: value.delta };
  if (value.type === "finish")
    return {
      type: "finish",
      usage: {
        inputTokens: value.usage?.inputTokens?.total ?? 0,
        outputTokens: value.usage?.outputTokens?.total ?? 0,
      },
    };
  if (value.type === "error")
    return {
      type: "error",
      error:
        "The response was interrupted. Usage is awaiting reconciliation; try again after it is resolved.",
    };
  return null;
}
