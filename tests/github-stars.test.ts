import { describe, expect, test } from "bun:test";
import { fetchGitHubStars, parseGitHubStars } from "../apps/web/lib/github-stars";

describe("GitHub repository stars", () => {
  test("accepts actual counts including zero, rejects missing or invalid values", () => {
    expect(parseGitHubStars({ stargazers_count: 0 })).toBe(0);
    expect(parseGitHubStars({ stargazers_count: 1234 })).toBe(1234);
    for (const value of [null, {}, { stargazers_count: -1 }, { stargazers_count: "42" }, { stargazers_count: 1.5 }]) expect(parseGitHubStars(value)).toBeNull();
  });
  test("uses the intended public repository and gracefully handles rate limits and failures", async () => {
    let requested = "";
    const success = async (url: string) => { requested = url; return Response.json({ stargazers_count: 42 }); };
    expect(await fetchGitHubStars(success)).toBe(42);
    expect(requested).toBe("https://api.github.com/repos/elliotshohet/freecoda");
    expect(await fetchGitHubStars(async () => new Response("rate limited", { status: 403 }))).toBeNull();
    expect(await fetchGitHubStars(async () => { throw new Error("offline"); })).toBeNull();
  });
});
