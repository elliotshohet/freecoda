import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
const namespace = "freecoda-recovery-v1";
const basePattern = /^freecoda_restore_\d{17}_[a-f0-9]{10}$/;
type Fetch = typeof fetch;
type Credential = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
};
export async function privateJson(filename: string) {
  const info = await lstat(filename);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.size > 100_000
  )
    throw new Error("Private configuration must be an owner-only regular file");
  return JSON.parse(await readFile(filename, "utf8"));
}
export function validateManifest(value: any) {
  const base =
    typeof value.encryptedBackup === "string"
      ? value.encryptedBackup.replace(/\.dump\.aesgcm$/, "")
      : "";
  const start = Date.parse(value.completedAt),
    end = Date.parse(value.retentionExpiresAt);
  if (
    !basePattern.test(base) ||
    value.encryptedBackup !== `${base}.dump.aesgcm` ||
    value.status !== "verified" ||
    value.temporaryDatabaseDropped !== true ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.encryptedBytes) ||
    value.encryptedBytes < 44 ||
    !Number.isFinite(start) ||
    Math.abs(end - start - 7 * 86400_000) > 1000
  )
    throw new Error("Invalid verified recovery manifest");
  const allowed = [
    "completedAt",
    "retentionExpiresAt",
    "status",
    "versions",
    "encryptedBackup",
    "encryptedBytes",
    "sha256",
    "schemaHash",
    "encryptedPayloadsVerified",
    "expectedFixtureVerified",
    "containerRemoved",
    "tableCount",
    "rowCounts",
    "temporaryDatabaseDropped",
    "scope",
    "schemaNormalization",
  ];
  return {
    base,
    manifest: Object.fromEntries(
      allowed.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]),
    ),
  };
}
export class RecoveryDrive {
  constructor(
    private token: string,
    private folder: string,
    private request: Fetch = fetch,
  ) {
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(folder))
      throw new Error("Invalid recovery folder");
  }
  static async authorize(
    credential: Credential,
    folder: string,
    request: Fetch = fetch,
  ) {
    if (
      ![
        credential.client_id,
        credential.client_secret,
        credential.refresh_token,
      ].every((v) => typeof v === "string" && v.length > 5)
    )
      throw new Error("Dedicated Drive OAuth credential required");
    const r = await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({ ...credential, grant_type: "refresh_token" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error("Drive credential refresh failed");
    const v = await r.json();
    if (typeof v.access_token !== "string")
      throw new Error("Invalid Drive token response");
    return new RecoveryDrive(v.access_token, folder, request);
  }
  private async api(route: string, init: RequestInit = {}) {
    const response = await this.request(`https://www.googleapis.com/${route}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw new Error(`Drive operation failed (${response.status})`);
    return response;
  }
  async assertPrivateFolder() {
    const v = await (
      await this.api(
        `drive/v3/files/${this.folder}?fields=id,mimeType,shared,ownedByMe`,
      )
    ).json();
    if (
      v.id !== this.folder ||
      v.mimeType !== "application/vnd.google-apps.folder" ||
      v.shared !== false ||
      v.ownedByMe !== true
    )
      throw new Error("Recovery folder must be private and owned by operator");
  }
  async upload(archive: string, original: any) {
    const { base, manifest } = validateManifest(original);
    if (path.basename(archive) !== original.encryptedBackup)
      throw new Error("Archive name mismatch");
    const info = await lstat(archive);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      info.size !== original.encryptedBytes ||
      info.size > 512 * 1024 * 1024
    )
      throw new Error("Invalid private archive");
    const bytes = await readFile(archive);
    if (createHash("sha256").update(bytes).digest("hex") !== original.sha256)
      throw new Error("Archive digest mismatch");
    await this.assertPrivateFolder();
    let uploaded = 0;
    for (const [name, data, mime] of [
      [`${base}.dump.aesgcm`, bytes, "application/octet-stream"],
      [
        `${base}.json`,
        Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
        "application/json",
      ],
    ] as const) {
      const digest = createHash("sha256").update(data).digest("hex");
      const query = new URLSearchParams({
        q: `'${this.folder}' in parents and trashed=false and name='${name}'`,
        fields:
          "nextPageToken,files(id,name,parents,ownedByMe,shared,appProperties)",
        pageSize: "100",
      });
      const existing = await (await this.api(`drive/v3/files?${query}`)).json();
      if (
        !Array.isArray(existing.files) ||
        existing.nextPageToken ||
        existing.files.length > 1
      )
        throw new Error("Ambiguous existing recovery artifact");
      let file = existing.files[0];
      if (file) {
        const tags = file.appProperties || {};
        if (
          !/^[A-Za-z0-9_-]+$/.test(file.id) ||
          file.name !== name ||
          file.ownedByMe !== true ||
          file.shared !== false ||
          file.parents?.length !== 1 ||
          file.parents[0] !== this.folder ||
          tags.namespace !== namespace ||
          tags.base !== base ||
          tags.completedAt !== original.completedAt ||
          tags.expiresAt !== original.retentionExpiresAt ||
          tags.sha256 !== digest
        )
          throw new Error("Existing recovery artifact does not match");
      } else {
        const boundary = `freecoda-${randomUUID()}`;
        const metadata = {
          name,
          parents: [this.folder],
          appProperties: {
            namespace,
            base,
            expiresAt: original.retentionExpiresAt,
            completedAt: original.completedAt,
            sha256: digest,
          },
        };
        const body = new Blob([
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
          data,
          `\r\n--${boundary}--\r\n`,
        ]);
        file = await (
          await this.api(
            "upload/drive/v3/files?uploadType=multipart&fields=id",
            {
              method: "POST",
              headers: {
                "Content-Type": `multipart/related; boundary=${boundary}`,
              },
              body,
            },
          )
        ).json();
        uploaded++;
      }
      if (!/^[A-Za-z0-9_-]+$/.test(file.id))
        throw new Error("Invalid Drive upload response");
      const downloaded = Buffer.from(
        await (
          await this.api(`drive/v3/files/${file.id}?alt=media`)
        ).arrayBuffer(),
      );
      if (!downloaded.equals(data))
        throw new Error("Remote backup verification failed");
    }
    return { uploaded, reused: 2 - uploaded, downloadVerified: 2 };
  }
  async prune(now = new Date()) {
    await this.assertPrivateFolder();
    let pageToken = "",
      deleted = 0,
      rejected = 0;
    do {
      const q = `'${this.folder}' in parents and trashed=false and appProperties has { key='namespace' and value='${namespace}' }`;
      const params = new URLSearchParams({
        q,
        fields:
          "nextPageToken,files(id,name,parents,ownedByMe,shared,appProperties)",
        pageSize: "100",
        ...(pageToken ? { pageToken } : {}),
      });
      const result = await (await this.api(`drive/v3/files?${params}`)).json();
      for (const file of result.files || []) {
        const p = file.appProperties || {},
          start = Date.parse(p.completedAt),
          end = Date.parse(p.expiresAt);
        if (
          !basePattern.test(p.base) ||
          ![`${p.base}.json`, `${p.base}.dump.aesgcm`].includes(file.name) ||
          p.namespace !== namespace ||
          file.ownedByMe !== true ||
          file.shared !== false ||
          file.parents?.length !== 1 ||
          file.parents[0] !== this.folder ||
          !Number.isFinite(start) ||
          Math.abs(end - start - 7 * 86400_000) > 1000 ||
          !/^[a-f0-9]{64}$/.test(p.sha256) ||
          !/^[A-Za-z0-9_-]+$/.test(file.id)
        ) {
          rejected++;
          continue;
        }
        if (end > now.getTime()) continue;
        // A changed remote file must not be silently discarded under our retention policy.
        const bytes = Buffer.from(
          await (
            await this.api(`drive/v3/files/${file.id}?alt=media`)
          ).arrayBuffer(),
        );
        if (createHash("sha256").update(bytes).digest("hex") !== p.sha256) {
          rejected++;
          continue;
        }
        await this.api(`drive/v3/files/${file.id}`, { method: "DELETE" });
        deleted++;
      }
      pageToken = result.nextPageToken || "";
    } while (pageToken);
    return { deleted, rejected };
  }
}
if (import.meta.main) {
  try {
    const [manifestFile] = process.argv.slice(2),
      credentialFile = process.env.FREECODA_DRIVE_CREDENTIAL_FILE,
      folder = process.env.FREECODA_DRIVE_FOLDER_ID;
    if (!manifestFile || !credentialFile || !folder)
      throw new Error("Configuration required");
    const drive = await RecoveryDrive.authorize(
      await privateJson(credentialFile),
      folder,
    );
    const manifest = await privateJson(manifestFile);
    const upload = await drive.upload(
      path.join(path.dirname(manifestFile), manifest.encryptedBackup),
      manifest,
    );
    const retention = await drive.prune();
    console.log(
      JSON.stringify({ status: "verified", ...upload, ...retention }),
    );
    if (retention.rejected) process.exitCode = 1;
  } catch {
    console.error(
      "Recovery Drive operation failed; inspect private configuration and provider access.",
    );
    process.exitCode = 1;
  }
}
