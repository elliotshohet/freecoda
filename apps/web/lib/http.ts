import { z } from "zod";
import { randomUUID } from "node:crypto";
import { failureCategory } from "./observability";
import { appUrl } from "./config";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(appUrl()).origin)
    throw new ApiError(403, "Open this action from your Freecoda workspace.");
}
export async function jsonBody<T>(
  req: Request,
  schema: z.ZodType<T>,
  limit = 100_000,
): Promise<T> {
  if (Number(req.headers.get("content-length") || 0) > limit)
    throw new ApiError(413, "Request is too large.");
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "A JSON body is required.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError(413, "Request is too large.");
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  let body;
  try {
    body = JSON.parse(bytes.toString());
  } catch {
    throw new ApiError(400, "Invalid JSON.");
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(400, "Invalid request fields.");
  return result.data;
}
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError)
      return Response.json(
        { error: e.message },
        { status: e.status, headers: { "Cache-Control": "no-store" } },
      );
    const requestId = randomUUID();
    console.error(
      JSON.stringify({
        event: "api_failure",
        requestId,
        category: failureCategory(e),
      }),
    );
    return Response.json(
      {
        error: "The service is temporarily unavailable. Try again shortly.",
        requestId,
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "X-Request-ID": requestId },
      },
    );
  }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
