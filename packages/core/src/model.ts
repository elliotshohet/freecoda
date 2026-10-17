import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4GenerateResult,
} from "@ai-sdk/provider";
export function validateBaseURL(value: string) {
  const u = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback))
    throw new Error("Provider URL must use HTTPS, or HTTP on loopback.");
  if (u.username || u.password || u.search || u.hash)
    throw new Error(
      "Provider URL cannot contain credentials, query strings, or fragments.",
    );
  return u.toString().replace(/\/$/, "");
}
export function directModel(baseURL: string, model: string, apiKey: string) {
  return createOpenAICompatible({
    name: "direct",
    baseURL: validateBaseURL(baseURL),
    apiKey,
  })(model);
}
export function hostedModel(
  baseURL: string,
  modelId: string,
  token: string,
): LanguageModelV4 {
  const base = validateBaseURL(baseURL);
  async function call(operation: string, opts: LanguageModelV4CallOptions) {
    const { abortSignal, headers, ...options } = opts;
    const response = await fetch(`${base}/api/v1/inference`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ protocol: 1, operation, model: modelId, options }),
      signal: abortSignal,
      redirect: "error",
    });
    if (!response.ok) {
      const data = await response
        .json()
        .catch(() => ({ error: "Hosted inference is unavailable." }));
      throw new Error(data.error || `Request failed (${response.status}).`);
    }
    return response;
  }
  return {
    specificationVersion: "v4",
    provider: "freecoda",
    modelId,
    supportedUrls: {},
    doGenerate: async (opts) =>
      (await (
        await call("generate", opts)
      ).json()) as LanguageModelV4GenerateResult,
    doStream: async (opts) => {
      const response = await call("stream", opts);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          async pull(controller) {
            try {
              for (;;) {
                const newline = pending.indexOf("\n");
                if (newline >= 0) {
                  const line = pending.slice(0, newline);
                  pending = pending.slice(newline + 1);
                  if (!line) continue;
                  const part = JSON.parse(line);
                  if (part.type === "response-metadata" && part.timestamp)
                    part.timestamp = new Date(part.timestamp);
                  controller.enqueue(part);
                  return;
                }
                const { done, value } = await reader.read();
                if (done) {
                  if (pending.trim())
                    throw new Error("Truncated inference stream.");
                  controller.close();
                  return;
                }
                pending += decoder.decode(value, { stream: true });
                if (pending.length > 1_000_000)
                  throw new Error("Invalid inference stream.");
              }
            } catch (e) {
              controller.error(e);
              await reader.cancel();
            }
          },
          cancel: () => reader.cancel(),
        }),
      };
    },
  };
}
