import { test, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "../apps/web/lib/cloud/crypto";
import { allowedSource } from "../apps/web/lib/cloud/github";
import {
  createPreviewTicket,
  previewPublicKey,
  verifyPreviewTicket,
} from "../apps/web/lib/cloud/preview-proxy";

test("encrypted cloud content cannot be moved between projects or modified", () => {
  process.env.CLOUD_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const source = { content: "private source and prompt" };
  const encrypted = encrypt(source, "project:alice");
  expect(encrypted).not.toContain(source.content);
  expect(decrypt(encrypted, "project:alice")).toEqual(source);
  expect(() => decrypt(encrypted, "project:bob")).toThrow();
  const bytes = Buffer.from(encrypted, "base64");
  bytes[bytes.length - 1] ^= 1;
  expect(() => decrypt(bytes.toString("base64"), "project:alice")).toThrow();
});

test("preview tickets expire and cannot cross sandbox or project boundaries", () => {
  process.env.CLOUD_PREVIEW_SECRET =
    "test-preview-key-that-is-at-least-32-characters";
  const now = Date.now();
  const { token } = createPreviewTicket("alice-project", "sandbox-1", now);
  const key = previewPublicKey();
  expect(
    verifyPreviewTicket(token, key, "alice-project", "sandbox-1", now),
  ).toBe(true);
  expect(verifyPreviewTicket(token, key, "bob-project", "sandbox-1", now)).toBe(
    false,
  );
  expect(
    verifyPreviewTicket(token, key, "alice-project", "sandbox-2", now),
  ).toBe(false);
  expect(
    verifyPreviewTicket(
      token,
      key,
      "alice-project",
      "sandbox-1",
      now + 300_001,
    ),
  ).toBe(false);
  expect(
    verifyPreviewTicket(
      token + ".extra",
      key,
      "alice-project",
      "sandbox-1",
      now,
    ),
  ).toBe(false);
});

test("source import excludes credentials and traversal but allows application source", () => {
  for (const path of [
    "../secret",
    "/etc/passwd",
    ".env",
    "apps/web/.env.local",
    ".git/config",
    ".ssh/id_rsa",
    "deploy/private.key",
    ".npmrc",
    "apps/web/.netrc",
    ".data/local-credentials.json",
  ]) {
    expect(allowedSource(path)).toBe(false);
  }
  for (const path of [
    "package.json",
    "apps/web/src/app.tsx",
    "src/config.ts",
  ]) {
    expect(allowedSource(path)).toBe(true);
  }
});

test("manual source edit validation preserves executable mode and rejects archive overflow before mutation", async () => {
  const { proposedSourceEdit } =
    await import("../apps/web/lib/cloud/source-edit");
  const files = [
    { path: "bin/start", content: "old", mode: "100755" as const },
  ];
  expect(proposedSourceEdit(files, "bin/start", "new")[0]).toEqual({
    path: "bin/start",
    content: "new",
    mode: "100755",
  });
  const full = Array.from({ length: 10000 }, (_, index) => ({
    path: `file${index}`,
    content: "",
  }));
  expect(() => proposedSourceEdit(full, "overflow", "x")).toThrow("10,000");
  expect(full).toHaveLength(10000);
  expect(files[0].content).toBe("old");
});

test("public model catalog cannot expose server-only credential or routing fields", async () => {
  const { publicModelConfig } = await import("../apps/web/lib/public-model");
  const config = {
    id: "openai/gpt-5-mini",
    provider: "openai",
    byok: true,
    inputMicrosPerToken: 0.25,
    outputMicrosPerToken: 2,
    maxContextTokens: 400000,
    approved: true,
    apiKey: "private-secret",
    providerOptions: {
      gateway: { byok: { openai: [{ apiKey: "private-secret" }] } },
    },
  };
  const publicValue = publicModelConfig(config);
  expect(publicValue.id).toBe(config.id);
  expect(publicValue.byok).toBe(true);
  expect(JSON.stringify(publicValue)).not.toContain("private-secret");
  expect(publicValue).not.toHaveProperty("providerOptions");
});
