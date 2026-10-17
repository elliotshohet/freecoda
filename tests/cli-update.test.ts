import { describe, expect, test } from "bun:test";
import {
  checkUpdate,
  installCommand,
  newerVersion,
  validVersion,
} from "../packages/cli/src/update";
const metadata =
  (body: unknown) => async (_input: unknown, init: RequestInit) => {
    expect(_input).toBe("https://registry.npmjs.org/freecoda/latest");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    return new Response(JSON.stringify(body));
  };
describe("CLI updates", () => {
  test("compares numeric stable versions without downgrades", () => {
    expect(newerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(newerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(newerVersion("0.0.9", "0.1.0")).toBe(false);
    expect(newerVersion("1.0.0-beta.1", "0.1.0")).toBe(false);
  });
  test("rejects registry version strings that could alter npm arguments", () => {
    for (const version of [
      "1.0.0;touch /tmp/x",
      "--help",
      "01.0.0",
      "1.0.0\n",
      "https://example.com",
      "9999999999.0.0",
    ]) {
      expect(validVersion(version)).toBe(false);
      expect(() => installCommand(version)).toThrow();
    }
    expect(installCommand("0.2.0")).toBe(
      "npm install --global freecoda@0.2.0 --registry=https://registry.npmjs.org --ignore-scripts",
    );
  });
  test("accepts only the fixed package's valid metadata", async () => {
    expect(
      await checkUpdate(metadata({ name: "freecoda", version: "0.2.0" })),
    ).toBe("0.2.0");
    await expect(
      checkUpdate(metadata({ name: "other", version: "0.2.0" })),
    ).rejects.toThrow("invalid");
    await expect(
      checkUpdate(metadata({ name: "freecoda", version: "1.0.0 && evil" })),
    ).rejects.toThrow("invalid");
  });
  test("rejects registry failures and oversized responses", async () => {
    await expect(
      checkUpdate(async () => new Response("missing", { status: 404 })),
    ).rejects.toThrow();
    await expect(
      checkUpdate(async () => new Response("x".repeat(65537))),
    ).rejects.toThrow("oversized");
  });
});
