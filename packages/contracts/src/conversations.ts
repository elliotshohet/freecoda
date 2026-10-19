import { z } from "zod";
import type { ModelMessage } from "ai";
const privateFields =
  /^(?:providerMetadata|providerOptions|apiKey|api_key|authorization|accessToken|refreshToken|headers)$/i;
function publicMessageValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicMessageValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, item]) => !privateFields.test(key) && item !== undefined)
        .map(([key, item]) => [key, publicMessageValue(item)]),
    );
  return value;
}
export const conversationModeSchema = z.enum(["chat", "coding"]);
const part = z
  .record(z.string(), z.json())
  .refine(
    (value) =>
      typeof value.type === "string" &&
      [
        "text",
        "reasoning",
        "image",
        "file",
        "tool-call",
        "tool-result",
      ].includes(value.type),
  );
export const conversationMessagesSchema = z
  .preprocess(
    publicMessageValue,
    z.array(
    z
      .object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z.union([z.string(), z.array(part).max(500)]),
        status: z.enum(["complete", "partial", "stopped", "error"]).optional(),
      })
      .strip(),
    ).max(500),
  )
  .transform((messages) => messages as ConversationMessage[]);
export const conversationWriteSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    mode: conversationModeSchema,
    messages: conversationMessagesSchema,
    expectedVersion: z.number().int().positive().safe().nullable(),
  })
  .strict();
export type ConversationMessage = ModelMessage & {
  status?: "complete" | "partial" | "stopped" | "error";
};
export type ConversationSummary = {
  id: string;
  title: string;
  mode: "chat" | "coding";
  updatedAt: string;
  version: number;
};
export type ConversationRecord = ConversationSummary & {
  messages: ConversationMessage[];
};
export type ConversationList = {
  userId: string;
  conversations: ConversationSummary[];
  nextCursor: string | null;
  hasMore: boolean;
};
