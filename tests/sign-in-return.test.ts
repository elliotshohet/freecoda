import { describe, expect, test } from "bun:test";
import { browserEntryPath, safeSignInReturn, signInPath } from "../apps/web/lib/sign-in-return";

describe("browser sign-in return boundaries", () => {
  test("preserves the intended supported application destination", () => {
    expect(safeSignInReturn("/chat?thread=thread-1#latest")).toBe("/chat?thread=thread-1#latest");
    expect(safeSignInReturn("/settings")).toBe("/settings");
    expect(browserEntryPath("/app", { view: "workspace", project: "project-1" })).toBe("/app?view=workspace&project=project-1");
    expect(signInPath("/chat?thread=thread-1")).toBe("/sign-in?returnTo=%2Fchat%3Fthread%3Dthread-1");
  });

  test("rejects external, malformed, unsupported, and recursive destinations", () => {
    for (const value of [
      undefined, "", "https://example.com/app", "//example.com/app",
      "/\\example.com/app", "/app\\evil", "/app\nLocation: evil",
      "/sign-in?returnTo=/sign-in", "/app/../sign-in", "/app%2F..%2Fsign-in",
      "/api/auth/callback/github", `/app?value=${"a".repeat(4096)}`,
    ]) expect(safeSignInReturn(value)).toBe("/app");
  });

  test("serializes repeated query parameters without creating a redirect target", () => {
    expect(browserEntryPath("/chat", { thread: ["one", "two"], omitted: undefined })).toBe("/chat?thread=one&thread=two");
    expect(signInPath("//example.com", true)).toBe("/sign-in?returnTo=%2Fapp&reason=unavailable");
  });
});
