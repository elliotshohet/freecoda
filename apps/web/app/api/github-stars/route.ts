import { fetchGitHubStars } from "@/lib/github-stars";

export async function GET() {
  const stars = await fetchGitHubStars();
  return Response.json({ stars }, {
    headers: { "Cache-Control": stars === null ? "public, max-age=30" : "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
