import { test, expect } from "bun:test";
import { RecoveryDrive, validateManifest } from "../scripts/recovery-drive";
import { createHash } from "node:crypto";
const base = "freecoda_restore_20261017231048395_688958a7d7",
  folder = "test_private_folder_123";
const completedAt = "2026-10-17T23:11:08.867Z",
  retentionExpiresAt = "2026-10-24T23:11:08.867Z";
const bytes = Buffer.from("encrypted-only-fixture");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  encryptedBackup: `${base}.dump.aesgcm`,
  status: "verified",
  temporaryDatabaseDropped: true,
  sha256,
  encryptedBytes: 100,
  completedAt,
  retentionExpiresAt,
  keyFile: "never-upload",
  cloudKey: "never-upload",
};
test("remote manifest strips local key paths and unexpected secret properties", () => {
  const clean = validateManifest(manifest).manifest;
  expect(clean).not.toHaveProperty("keyFile");
  expect(clean).not.toHaveProperty("cloudKey");
  expect(() =>
    validateManifest({ ...manifest, retentionExpiresAt: "2030-01-01" }),
  ).toThrow();
  expect(() =>
    validateManifest({ ...manifest, encryptedBackup: "../credentials.json" }),
  ).toThrow();
});
test("remote expiry deletes only private owned exact tagged artifacts with verified digest", async () => {
  const deleted: string[] = [];
  const valid = {
    id: "old_archive_123",
    name: `${base}.dump.aesgcm`,
    ownedByMe: true,
    shared: false,
    parents: [folder],
    appProperties: {
      namespace: "freecoda-recovery-v1",
      base,
      completedAt,
      expiresAt: retentionExpiresAt,
      sha256,
    },
  };
  const fake = (async (input: any, init: any) => {
    const url = String(input);
    if (init?.method === "DELETE") {
      deleted.push(url);
      return new Response(null, { status: 204 });
    }
    if (url.includes("alt=media")) return new Response(bytes);
    if (url.includes("?q="))
      return Response.json({
        files: [
          valid,
          { ...valid, id: "shared", shared: true },
          { ...valid, id: "elsewhere", parents: ["other"] },
          { ...valid, id: "renamed", name: "unrelated.txt" },
          {
            ...valid,
            id: "changed",
            appProperties: { ...valid.appProperties, sha256: "0".repeat(64) },
          },
        ],
      });
    return Response.json({
      id: folder,
      mimeType: "application/vnd.google-apps.folder",
      shared: false,
      ownedByMe: true,
    });
  }) as unknown as typeof fetch;
  const result = await new RecoveryDrive("private-token", folder, fake).prune(
    new Date("2026-10-25"),
  );
  expect(result).toEqual({ deleted: 1, rejected: 4 });
  expect(deleted).toHaveLength(1);
  expect(deleted[0]).toContain("old_archive_123");
});
test("shared destination fails closed before listing or deletion", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return Response.json({
      id: folder,
      mimeType: "application/vnd.google-apps.folder",
      shared: true,
      ownedByMe: true,
    });
  }) as unknown as typeof fetch;
  await expect(
    new RecoveryDrive("private-token", folder, fake).prune(),
  ).rejects.toThrow("private");
  expect(calls).toBe(1);
});

test("upload replay repairs interrupted pairs without duplicate objects and rejects collisions", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-drive-test-"));
  const data = Buffer.alloc(64, "a");
  const validManifest = {
    ...manifest,
    encryptedBytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
  const objects: any[] = [];
  let failSecond = true,
    posts = 0;
  const fake = (async (input: any, init: any) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/upload/")) {
      posts++;
      if (posts === 2 && failSecond) {
        failSecond = false;
        return new Response(null, { status: 503 });
      }
      const text = await (init.body as Blob).text();
      const pieces = [...text.matchAll(/\r\n\r\n(.*?)\r\n--/gs)].map(
        (m) => m[1],
      );
      const metadata = JSON.parse(pieces[0]!);
      const object = {
        ...metadata,
        id: `fixture_${objects.length}`,
        ownedByMe: true,
        shared: false,
        bytes: Buffer.from(pieces[1]!),
      };
      objects.push(object);
      return Response.json({ id: object.id });
    }
    if (url.searchParams.get("alt") === "media") {
      const id = url.pathname.split("/").at(-1);
      return new Response(objects.find((o) => o.id === id).bytes);
    }
    if (url.searchParams.has("q")) {
      const name = /name='([^']+)'/.exec(url.searchParams.get("q")!)?.[1];
      return Response.json({ files: objects.filter((o) => o.name === name) });
    }
    return Response.json({
      id: folder,
      mimeType: "application/vnd.google-apps.folder",
      shared: false,
      ownedByMe: true,
    });
  }) as typeof fetch;
  try {
    const archive = path.join(directory, validManifest.encryptedBackup);
    await writeFile(archive, data, { mode: 0o600 });
    const drive = new RecoveryDrive("fixture-token", folder, fake);
    await expect(drive.upload(archive, validManifest)).rejects.toThrow();
    expect(objects).toHaveLength(1);
    await drive.upload(archive, validManifest);
    expect(objects).toHaveLength(2);
    expect(posts).toBe(3);
    await drive.upload(archive, validManifest);
    expect(posts).toBe(3);
    objects[0].appProperties.sha256 = "0".repeat(64);
    await expect(drive.upload(archive, validManifest)).rejects.toThrow(
      "does not match",
    );
    expect(posts).toBe(3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
