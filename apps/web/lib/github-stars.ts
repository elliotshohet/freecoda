export const githubRepositoryUrl = "https://github.com/elliotshohet/freecoda";

export function parseGitHubStars(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const stars = (value as Record<string, unknown>).stargazers_count;
  return typeof stars === "number" && Number.isSafeInteger(stars) && stars >= 0 ? stars : null;
}

type GitHubFetch = (url: string, options?: RequestInit) => Promise<Response>;

export async function fetchGitHubStars(fetcher: GitHubFetch = fetch): Promise<number | null> {
  try {
    const options: RequestInit & { next: { revalidate: number } } = {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Freecoda-Website" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    };
    const response = await fetcher("https://api.github.com/repos/elliotshohet/freecoda", options);
    return response.ok ? parseGitHubStars(await response.json()) : null;
  } catch {
    return null;
  }
}
