import { test, expect } from "bun:test";
import {
  utcDay,
  utcMonth,
  nextReset,
  modelCallSchema,
  sponsorInquirySchema,
} from "../packages/contracts/src";
import { safeModelOptions, maxRequestCost } from "../apps/web/lib/inference";
const model = {
  id: "test/model",
  provider: "test",
  inputMicrosPerToken: 1,
  outputMicrosPerToken: 2,
  maxContextTokens: 200000,
  approved: true,
};
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
