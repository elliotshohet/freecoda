import { test, expect } from "bun:test";
import {
  utcDay,
  utcMonth,
  nextReset,
  modelCallSchema,
  sponsorInquirySchema,
} from "../packages/contracts/src";
import { safeModelOptions, maxRequestCost } from "../apps/web/lib/inference";
import {
  hostedProviderModel,
  generationAccounting,
  GATEWAY_OPENAI_MODEL,
  sanitizeProviderResult,
} from "../apps/web/lib/hosted-provider";
const byokModel = {
  id: "openai/gpt-5-mini",
  provider: "openai",
  byok: true,
  inputMicrosPerToken: 0.25,
  outputMicrosPerToken: 2,
  maxContextTokens: 400000,
  approved: true,
};
const model = {
  id: "test/model",
  provider: "test",
  inputMicrosPerToken: 1,
  outputMicrosPerToken: 2,
  maxContextTokens: 200000,
  approved: true,
};
test('trusted hosted calls preserve live cancellation signals',()=>{
  const controller=new AbortController();
  const options=safeModelOptions({prompt:[{role:'user',content:[{type:'text',text:'Hello'}]}],abortSignal:controller.signal},model);
  expect(options.abortSignal).toBe(controller.signal);
  controller.abort();
  expect(options.abortSignal?.aborted).toBe(true);
});
test("quotas use UTC boundaries and next calendar day", () => {
  const date = new Date("2026-12-31T23:59:59.000Z");
  expect(utcDay(date)).toBe("2026-12-31");
  expect(utcMonth(date)).toBe("2026-12");
  expect(nextReset(date)).toBe("2027-01-01T00:00:00.000Z");
});
test("server overwrites client routing and rejects remote file parts", () => {
  const opts = safeModelOptions(
    {
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "hello",
              providerOptions: { gateway: { disallowPromptTraining: false } },
            },
          ],
        },
      ],
      providerOptions: { gateway: { only: ["wrong"] } },
    },
    model,
  );
  expect(opts.providerOptions?.gateway).toMatchObject({
    only: ["test"],
    disallowPromptTraining: true,
  });
  expect(JSON.stringify(opts.prompt)).not.toContain("providerOptions");
  expect(() =>
    safeModelOptions(
      {
        prompt: [
          {
            role: "user",
            content: [{ type: "file", data: "https://private.internal" }],
          },
        ],
      },
      model,
    ),
  ).toThrow();
});
test("reservation is an upper bound and includes output tokens", () => {
  expect(maxRequestCost(model, 1000, 1000)).toBe(11192);
  expect(() =>
    maxRequestCost({ ...model, maxContextTokens: 500 }, 1000, 1000),
  ).toThrow();
});
test("no arbitrary request headers or tools are accepted", () => {
  expect(
    modelCallSchema.safeParse({
      protocol: 1,
      operation: "stream",
      model: "test",
      options: { prompt: [], headers: { Authorization: "override" } },
    }).success,
  ).toBe(false);
  expect(() =>
    safeModelOptions(
      {
        prompt: [{ role: "system", content: "test" }],
        tools: [{ type: "provider-defined", id: "remote" }],
      },
      model,
    ),
  ).toThrow();
});
test("sponsor inquiries validate HTTPS, real email shape, and field lengths", () => {
  expect(
    sponsorInquirySchema.safeParse({
      business: "test",
      email: "bad",
      website: "javascript:alert(1)",
      message: "hello world",
    }).success,
  ).toBe(false);
});

test("nested tool result files cannot bypass the text-only gateway boundary", () => {
  expect(() =>
    safeModelOptions(
      {
        prompt: [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                output: {
                  type: "content",
                  value: [
                    {
                      type: "file",
                      data: { type: "url", url: "https://private.internal" },
                      mediaType: "text/plain",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      model,
    ),
  ).toThrow("Only text tool results");
  expect(() => safeModelOptions({ prompt: [null] }, model)).toThrow(
    "Invalid message role",
  );
  expect(() =>
    safeModelOptions(
      {
        prompt: [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                output: { type: "json", value: { answer: 42 } },
              },
            ],
          },
        ],
      },
      model,
    ),
  ).not.toThrow();
});

const fixtureUsage = {
  inputTokens: {
    total: 100,
    noCache: 20,
    cacheRead: 80,
    cacheWrite: undefined,
  },
  outputTokens: { total: 50, text: 10, reasoning: 40 },
};
test("Gateway BYOK includes separately billed cached input and reasoning despite zero Gateway charge", () => {
  const result = {
    usage: fixtureUsage,
    providerMetadata: { gateway: { cost: 0, generationId: "gateway_fixture" } },
  };
  expect(generationAccounting(result, byokModel)).toEqual({
    cost: 125,
    generationId: "gateway_fixture",
  });
  expect(
    generationAccounting(
      {
        ...result,
        providerMetadata: {
          gateway: { cost: "0.000200", generationId: "gateway_fixture" },
        },
      },
      byokModel,
    ).cost,
  ).toBe(200);
  expect(
    generationAccounting(
      {
        ...result,
        usage: {
          ...fixtureUsage,
          inputTokens: { ...fixtureUsage.inputTokens, total: undefined },
        },
      },
      byokModel,
    ).cost,
  ).toBeUndefined();
  expect(
    generationAccounting(
      {
        ...result,
        usage: {
          ...fixtureUsage,
          outputTokens: { ...fixtureUsage.outputTokens, total: NaN },
        },
      },
      byokModel,
    ).cost,
  ).toBeUndefined();
  expect(
    generationAccounting(
      {
        ...result,
        usage: {
          ...fixtureUsage,
          outputTokens: { ...fixtureUsage.outputTokens, reasoning: 51 },
        },
      },
      byokModel,
    ).cost,
  ).toBeUndefined();
  expect(
    generationAccounting({ ...result, providerMetadata: undefined }, byokModel)
      .cost,
  ).toBeUndefined();
  expect(generationAccounting(result, model).cost).toBe(0);
});
test("hosted SDK routes through Gateway with server-owned BYOK and never exposes request credentials", async () => {
  const previous = process.env.OPENAI_API_KEY,
    previousGateway = process.env.AI_GATEWAY_API_KEY;
  const fixtureKey = "test-fixture-provider-key-not-real";
  process.env.OPENAI_API_KEY = fixtureKey;
  process.env.AI_GATEWAY_API_KEY = "test-fixture-gateway-key-not-real";
  try {
    let requestUrl = "",
      body: Record<string, any> = {},
      headers: Headers | undefined;
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      body = JSON.parse(String(init?.body));
      headers = new Headers(init?.headers);
      return Response.json({
        content: [{ type: "text", text: "Ready" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: fixtureUsage,
        providerMetadata: {
          gateway: { cost: 0, generationId: "gateway_fixture" },
        },
        warnings: [],
      });
    }) as typeof fetch;
    const options = safeModelOptions(
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        maxOutputTokens: 100,
        providerOptions: {
          openai: { store: true, reasoningEffort: "high" },
          gateway: {
            only: ["wrong"],
            byok: { openai: [{ apiKey: "attacker-key" }] },
            zeroDataRetention: true,
          },
        },
      },
      byokModel,
    );
    const result = await hostedProviderModel(byokModel, fakeFetch).doGenerate(
      options,
    );
    expect(requestUrl).toBe(
      "https://ai-gateway.vercel.sh/v4/ai/language-model",
    );
    expect(headers?.get("ai-language-model-id")).toBe(GATEWAY_OPENAI_MODEL);
    expect(headers?.get("Authorization")).toBe(
      "Bearer test-fixture-gateway-key-not-real",
    );
    expect(body.providerOptions.gateway.only).toEqual(["openai"]);
    expect(body.providerOptions.gateway.disallowPromptTraining).toBe(true);
    expect(body.providerOptions.gateway.byok).toEqual({
      openai: [{ apiKey: fixtureKey }],
    });
    expect(body.providerOptions.gateway.zeroDataRetention).toBeUndefined();
    expect(body.providerOptions.openai).toMatchObject({
      store: false,
      reasoningEffort: "minimal",
      serviceTier: "default",
    });
    expect(generationAccounting(result, byokModel)).toEqual({
      cost: 125,
      generationId: "gateway_fixture",
    });
    const publicResult = sanitizeProviderResult({
      ...result,
      providerMetadata: {
        gateway: { byok: { openai: [{ apiKey: fixtureKey }] } },
        echo: fixtureKey,
      },
      content: [{ type: "text", text: `Echoed ${fixtureKey}` }],
      response: {
        headers: { Authorization: fixtureKey },
        body: { apiKey: fixtureKey },
      },
    });
    expect(JSON.stringify(publicResult)).not.toContain(fixtureKey);
    expect(publicResult).not.toHaveProperty("request");
    expect(() =>
      hostedProviderModel({ ...byokModel, inputMicrosPerToken: 0 }),
    ).toThrow("configuration");
    delete process.env.OPENAI_API_KEY;
    expect(() => hostedProviderModel(byokModel)).toThrow("credentials");
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
    if (previousGateway === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousGateway;
  }
});

test("assistant replay omits only empty reasoning placeholders and empty assistant messages", () => {
  const text = { type: "text", text: "Keep this answer." };
  const reasoning = {
    type: "reasoning",
    text: "Nonempty reasoning remains intact.",
  };
  const toolCall = {
    type: "tool-call",
    toolCallId: "call_fixture",
    toolName: "read_file",
    input: { path: "file.ts" },
  };
  const toolResult = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_fixture",
        toolName: "read_file",
        output: { type: "text", value: "File contents" },
      },
    ],
  };
  const prompt = [
    { role: "user", content: [{ type: "text", text: "Read the file." }] },
    { role: "assistant", content: [{ type: "reasoning", text: "" }] },
    {
      role: "assistant",
      content: [{ type: "reasoning", text: "" }, text, reasoning, toolCall],
    },
    toolResult,
  ];
  const options = safeModelOptions({ prompt }, model);
  expect<unknown>(options.prompt).toEqual([
    prompt[0],
    { role: "assistant", content: [text, reasoning, toolCall] },
    toolResult,
  ]);
  expect(prompt[1].content).toEqual([{ type: "reasoning", text: "" }]);
});
