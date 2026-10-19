import { githubRepositorySettingsSchema, type GithubRepositorySetting } from "@freecoda/contracts";
export { githubRepositorySettingsSchema, githubRepositorySettingSchema, type GithubRepositorySetting } from "@freecoda/contracts";
import { getPool, transaction } from "./db";
import { ApiError, json, jsonBody, sameOrigin } from "./http";
import { identity, rateLimit } from "./security";
import { gh, installationToken, repositories } from "./cloud/github";


export async function configuredGithubRepositories(userId: string): Promise<GithubRepositorySetting[]> {
  const { rows } = await getPool().query("SELECT settings FROM github_repository_settings WHERE user_id=$1", [userId]);
  return rows[0]?.settings || [];
}
export async function saveGithubRepositories(userId: string, settings: GithubRepositorySetting[]) {
  const unique = new Set(settings.map(repo => repo.repositoryId));
  if (unique.size !== settings.length) throw new ApiError(400, "Each repository may be configured once.");
  // Revalidate every repository on each save, including disabled entries. Never trust
  // client supplied IDs or an earlier list when installation access has changed.
  const verified: GithubRepositorySetting[] = [];
  for (const setting of settings) {
    const { token, repository } = await installationToken(userId, setting.installationId, setting.owner, setting.name, "read");
    if (repository.id !== setting.repositoryId) throw new ApiError(403, "Repository identity does not match GitHub access.");
    await gh(token, `/repos/${encodeURIComponent(setting.owner)}/${encodeURIComponent(setting.name)}/branches/${encodeURIComponent(setting.branch)}`);
    if (setting.appDirectory) {
      const result = await gh<{ type?: string } | unknown[]>(token, `/repos/${encodeURIComponent(setting.owner)}/${encodeURIComponent(setting.name)}/contents/${setting.appDirectory.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(setting.branch)}`);
      if (!Array.isArray(result)) throw new ApiError(400, "App directory must be a repository directory.");
    }
    verified.push({ ...setting, owner: repository.owner.login });
  }
  await transaction(async db => {
    await db.query("INSERT INTO github_repository_settings(user_id,settings) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=now()", [userId, JSON.stringify(verified)]);
  });
  return verified;
}
export async function githubRepositoryRoute(req: Request, path: string): Promise<Response | null> {
  if (path !== "github/repos" && path !== "github/repositories") return null;
  const user = await identity(req);
  await rateLimit(`github-repositories:${user.id}`, 30, 60);
  if (path === "github/repos" && req.method === "GET") return json(await repositories(user.id));
  if (path === "github/repositories" && req.method === "GET") return json({ repositories: await configuredGithubRepositories(user.id) });
  if (path === "github/repositories" && req.method === "PUT") {
    if (!user.device) sameOrigin(req);
    const body = await jsonBody(req, githubRepositorySettingsSchema, 100_000);
    return json({ repositories: await saveGithubRepositories(user.id, body.repositories) });
  }
  throw new ApiError(405, "Unsupported repository configuration method.");
}
