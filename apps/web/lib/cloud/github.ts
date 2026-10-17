import { createSign, randomUUID } from "node:crypto";
import { getPool } from "../db";
import { ApiError } from "../http";
import type { RepositorySource, SourceFile } from "./types";
import { validSourcePath } from "./sandbox";
export function githubReady() {
  return !!(
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_PRIVATE_KEY &&
    process.env.GITHUB_APP_SLUG
  );
}
const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function appToken() {
  if (!githubReady())
    throw new ApiError(503, "GitHub App integration is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: process.env.GITHUB_APP_ID })}`;
  const signature = createSign("RSA-SHA256")
    .update(input)
    .sign(
      process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      "base64url",
    );
  return `${input}.${signature}`;
}
export async function gh<T>(
  token: string,
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new ApiError(
      response.status === 404 ? 404 : response.status === 403 ? 403 : 502,
      "GitHub could not complete this request. Check the App installation and repository permissions.",
    );
  return (await response.json()) as T;
}
async function userToken(userId: string) {
  const row = (
    await getPool().query(
      'SELECT "accessToken" AS token FROM account WHERE "userId"=$1 AND "providerId"=\'github\'',
      [userId],
    )
  ).rows[0];
  if (!row?.token)
    throw new ApiError(403, "Reconnect GitHub to access repositories.");
  return row.token as string;
}
export async function installationToken(
  userId: string,
  installationId: number,
  owner: string,
  name: string,
) {
  const auth = await userToken(userId);
  const viewer = await gh<{ id: number; login: string }>(auth, "/user");
  const installation = await gh<{
    id: number;
    account: { id: number; login: string };
  }>(appToken(), `/app/installations/${installationId}`);
  if (installation.account.login.toLowerCase() !== owner.toLowerCase())
    throw new ApiError(
      403,
      "Installation owner does not match the repository.",
    );
  if (installation.account.id !== viewer.id) {
    const permissions = await gh<{ permissions?: { push?: boolean } }>(
      auth,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    );
    if (!permissions.permissions?.push)
      throw new ApiError(
        403,
        "Organization repositories require verified write access.",
      );
  }
  const result = await gh<{ token: string }>(
    appToken(),
    `/app/installations/${installationId}/access_tokens`,
    {
      repositories: [name],
      permissions: {
        contents: "write",
        pull_requests: "write",
        metadata: "read",
      },
    },
  );
  const repository = await gh<{
    id: number;
    permissions?: { push?: boolean };
    owner: { login: string };
    default_branch: string;
  }>(
    result.token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  );
  return { token: result.token, repository };
}
export async function repositories(userId: string) {
  const auth = await userToken(userId);
  const viewer = await gh<{ id: number }>(auth, "/user");
  const installations = await gh<
    { id: number; account: { id: number; login: string } }[]
  >(appToken(), "/app/installations?per_page=100");
  const repos = [];
  for (const installation of installations.filter(
    (installation) => installation.account.id === viewer.id,
  )) {
    const token = await gh<{ token: string }>(
      appToken(),
      `/app/installations/${installation.id}/access_tokens`,
      { permissions: { contents: "read", metadata: "read" } },
    );
    const result = await gh<{
      repositories: {
        name: string;
        owner: { login: string };
        default_branch: string;
        private: boolean;
      }[];
    }>(token.token, "/installation/repositories?per_page=100");
    repos.push(
      ...result.repositories.map((repo) => ({
        installationId: installation.id,
        owner: repo.owner.login,
        name: repo.name,
        defaultBranch: repo.default_branch,
        private: repo.private,
      })),
    );
  }
  return {
    repos,
    installUrl: process.env.GITHUB_APP_SLUG
      ? `https://github.com/apps/${encodeURIComponent(process.env.GITHUB_APP_SLUG)}/installations/new`
      : null,
  };
}
export function allowedSource(path: string) {
  try {
    validSourcePath(path);
    return true;
  } catch {
    return false;
  }
}
export async function importRepository(
  userId: string,
  data: { installationId: number; owner: string; repo: string; ref?: string },
) {
  const { token, repository } = await installationToken(
    userId,
    data.installationId,
    data.owner,
    data.repo,
  );
  const branch = data.ref || repository.default_branch;
  let targetBranch = repository.default_branch;
  if (data.ref && !/^[a-f0-9]{40}$/i.test(data.ref)) {
    const verified = await gh<{ name: string }>(
      token,
      `/repos/${data.owner}/${data.repo}/branches/${encodeURIComponent(data.ref)}`,
    );
    targetBranch = verified.name;
  }
  const commit = await gh<{ sha: string }>(
    token,
    `/repos/${data.owner}/${data.repo}/commits/${encodeURIComponent(branch)}`,
  );
  const tree = await gh<{
    truncated: boolean;
    tree: {
      path: string;
      type: string;
      mode: string;
      size?: number;
      sha: string;
    }[];
  }>(
    token,
    `/repos/${data.owner}/${data.repo}/git/trees/${commit.sha}?recursive=1`,
  );
  if (tree.truncated)
    throw new ApiError(413, "Repository tree is too large for this beta.");
  const candidates = tree.tree.filter(
    (file) =>
      file.type === "blob" &&
      ["100644", "100755"].includes(file.mode) &&
      allowedSource(file.path),
  );
  if (
    candidates.length > 10000 ||
    candidates.reduce((total, file) => total + (file.size || 0), 0) >
      100_000_000
  )
    throw new ApiError(
      413,
      "Repository source exceeds 100 MB or 10,000 files.",
    );
  const files: SourceFile[] = new Array(candidates.length);
  let cursor = 0;
  let actualBytes = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, candidates.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= candidates.length) return;
        const file = candidates[index];
        const blob = await gh<{ content: string; encoding: string }>(
          token,
          `/repos/${data.owner}/${data.repo}/git/blobs/${file.sha}`,
        );
        const decoded = Buffer.from(blob.content, "base64");
        actualBytes += decoded.length;
        if (actualBytes > 100_000_000)
          throw new ApiError(413, "Repository source exceeds 100 MB.");
        const text = decoded.toString("utf8");
        const binary =
          text.includes("\0") || !Buffer.from(text).equals(decoded);
        files[index] = {
          path: file.path,
          content: binary ? decoded.toString("base64") : text,
          encoding: binary ? "base64" : "utf8",
          mode: file.mode as "100644" | "100755",
        };
      }
    }),
  );
  const source: RepositorySource = {
    installationId: data.installationId,
    owner: data.owner,
    name: data.repo,
    repositoryId: repository.id,
    defaultBranch: targetBranch,
    baseSha: commit.sha,
    baseFiles: files,
  };
  return { source, files };
}
export function publicationChanges(
  baseFiles: SourceFile[],
  files: SourceFile[],
) {
  const original = new Map(
    baseFiles
      .filter((file) => allowedSource(file.path))
      .map((file) => [file.path, file]),
  );
  const changed = files
    .filter(
      (file) =>
        allowedSource(file.path) &&
        original.get(file.path)?.content !== file.content,
    )
    .sort((a, b) => a.path.localeCompare(b.path));
  const paths = new Set(files.map((file) => file.path));
  const deleted = [...original.values()]
    .filter((file) => !paths.has(file.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { changed, deleted };
}
export async function publishDraft(
  userId: string,
  repository: RepositorySource,
  files: SourceFile[],
  publicationId: string,
  title: string,
  body: string,
) {
  const { token } = await installationToken(
    userId,
    repository.installationId,
    repository.owner,
    repository.name,
  );
  const prefix = `/repos/${repository.owner}/${repository.name}`;
  const branch = `freecoda/review-${publicationId}`;
  const existing = await gh<{ html_url: string }[]>(
    token,
    `${prefix}/pulls?head=${encodeURIComponent(`${repository.owner}:${branch}`)}&state=all`,
  );
  if (existing[0]) return existing[0].html_url;
  const current = await gh<{ sha: string }>(
    token,
    `${prefix}/commits/${encodeURIComponent(repository.defaultBranch)}`,
  );
  if (current.sha !== repository.baseSha)
    throw new ApiError(
      409,
      "The repository changed since import. Reimport and review against the new base before publishing.",
    );
  const { changed, deleted } = publicationChanges(repository.baseFiles, files);
  if (!changed.length && !deleted.length)
    throw new ApiError(400, "There are no changes to publish.");
  if (
    [...changed, ...deleted].some(
      (file) =>
        !allowedSource(file.path) ||
        file.path.toLowerCase().startsWith(".github/workflows/"),
    )
  )
    throw new ApiError(
      403,
      "Credential paths and GitHub workflow publication are excluded.",
    );
  let branchExists = false;
  try {
    await gh(token, `${prefix}/git/ref/heads/${branch}`);
    branchExists = true;
  } catch {}
  if (!branchExists) {
    const parent = await gh<{ tree: { sha: string } }>(
      token,
      `${prefix}/git/commits/${repository.baseSha}`,
    );
    const treeEntries: {
      path: string;
      mode: string;
      type: string;
      sha?: string | null;
      content?: string;
    }[] = [];
    for (const file of changed) {
      if (file.encoding === "base64") {
        const blob = await gh<{ sha: string }>(token, `${prefix}/git/blobs`, {
          content: file.content,
          encoding: "base64",
        });
        treeEntries.push({
          path: file.path,
          mode:
            file.mode ||
            repository.baseFiles.find((base) => base.path === file.path)
              ?.mode ||
            "100644",
          type: "blob",
          sha: blob.sha,
        });
      } else
        treeEntries.push({
          path: file.path,
          mode:
            file.mode ||
            repository.baseFiles.find((base) => base.path === file.path)
              ?.mode ||
            "100644",
          type: "blob",
          content: file.content,
        });
    }
    treeEntries.push(
      ...deleted.map((file) => ({
        path: file.path,
        mode: file.mode || "100644",
        type: "blob",
        sha: null,
      })),
    );
    const tree = await gh<{ sha: string }>(token, `${prefix}/git/trees`, {
      base_tree: parent.tree.sha,
      tree: treeEntries,
    });
    const commit = await gh<{ sha: string }>(token, `${prefix}/git/commits`, {
      message: title,
      tree: tree.sha,
      parents: [repository.baseSha],
    });
    await gh(token, `${prefix}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    });
  }
  const pr = await gh<{ html_url: string }>(token, `${prefix}/pulls`, {
    title,
    body,
    head: branch,
    base: repository.defaultBranch,
    draft: true,
  });
  return pr.html_url;
}
