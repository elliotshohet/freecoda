import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, stat, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Writable, Readable, compose } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const header = Buffer.from("FREECODA-PG-GCM1\n");
type Manifest = {
  encryptedBytes: number;
  sha256: string;
  schemaHash: string;
  rowCounts: Record<string, string>;
  tableCount: number;
};
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
export async function restoreArchive(args: {
  archive: string;
  manifest: string;
  key: string;
  applicationKeyFile?: string;
  receipt?: string;
  context?: string;
}) {
  // Authenticate fully before creating resources or feeding any plaintext to pg_restore.
  const manifest = JSON.parse(
    await readFile(args.manifest, "utf8"),
  ) as Manifest;
  const info = await stat(args.archive);
  if (
    info.size < header.length + 29 ||
    manifest.encryptedBytes !== info.size ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    !/^[a-f0-9]{64}$/.test(manifest.schemaHash) ||
    !manifest.rowCounts ||
    typeof manifest.rowCounts !== "object" ||
    Array.isArray(manifest.rowCounts) ||
    Object.keys(manifest.rowCounts).length !== manifest.tableCount ||
    Object.values(manifest.rowCounts).some(
      (value) => typeof value !== "string" || !/^\d+$/.test(value),
    )
  )
    throw Error("Invalid recovery manifest");
  const archiveKey = await readFile(args.key);
  if (archiveKey.length !== 32) throw Error("Invalid recovery key");
  const handle = await open(args.archive, "r");
  const prefix = Buffer.alloc(header.length + 12),
    tag = Buffer.alloc(16);
  try {
    await handle.read(prefix, 0, prefix.length, 0);
    await handle.read(tag, 0, 16, info.size - 16);
  } finally {
    await handle.close();
  }
  if (!prefix.subarray(0, header.length).equals(header))
    throw Error("Invalid recovery header");
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(args.archive))
    digest.update(chunk);
  if (digest.digest("hex") !== manifest.sha256)
    throw Error("Archive checksum mismatch");
  const decipher = () => {
    const result = createDecipheriv(
      "aes-256-gcm",
      archiveKey,
      prefix.subarray(header.length),
    );
    result.setAAD(header);
    result.setAuthTag(tag);
    return result;
  };
  try {
    await pipeline(
      createReadStream(args.archive, {
        start: prefix.length,
        end: info.size - 17,
      }),
      decipher(),
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
    );
  } catch {
    archiveKey.fill(0);
    throw Error("Recovery archive authentication failed");
  }
  const plaintext = () =>
    compose(
      createReadStream(args.archive, {
        start: prefix.length,
        end: info.size - 17,
      }),
      decipher(),
    );
  let applicationKey: Buffer | undefined;
  if (args.applicationKeyFile) {
    const bytes = await readFile(args.applicationKeyFile);
    applicationKey =
      bytes.length === 32
        ? bytes
        : Buffer.from(bytes.toString().trim(), "base64");
    if (applicationKey.length !== 32)
      throw Error("Invalid application recovery key");
  }
  const container = `freecoda-independent-restore-${randomUUID()}`;
  let attempted = false;
  const children = new Set<ReturnType<typeof spawn>>();
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    for (const child of children) child.kill("SIGKILL");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  async function docker(
    command: string[],
    input?: Buffer | Readable,
    cleanup = false,
  ) {
    if (interrupted && !cleanup) throw Error("Restore interrupted");
    const child = spawn(
      "docker",
      [...(args.context ? ["--context", args.context] : []), ...command],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    children.add(child);
    const timer = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
    child.stdin.on("error", () => {});
    const output: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) child.kill("SIGKILL");
      else output.push(chunk);
    });
    child.stderr.resume(); // SQL/server diagnostics may contain recovered data; never print them.
    const feed =
      input instanceof Readable
        ? pipeline(input, child.stdin)
        : Promise.resolve(child.stdin.end(input));
    feed.catch(() => {});
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", () =>
          reject(
            Error(
              `Isolated restore ${command[0]}${command[0] === "exec" ? " " + command[3] : ""} command failed`,
            ),
          ),
        );
        child.once("close", (code) =>
          code === 0
            ? resolve()
            : reject(
                Error(
                  `Isolated restore ${command[0]}${command[0] === "exec" ? " " + command[3] : ""} command failed`,
                ),
              ),
        );
      });
    } finally {
      clearTimeout(timer);
      children.delete(child);
    }
    await feed;
    return Buffer.concat(output).toString();
  }
  const exec = (command: string[], input?: Buffer | Readable) =>
    docker(["exec", "-i", container, ...command], input);
  async function query(sql: string): Promise<Record<string, any>[]> {
    const output = await exec([
      "psql",
      "-U",
      "recovery",
      "-d",
      "recovery",
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `SELECT coalesce(json_agg(row_to_json(result)),'[]'::json) FROM (${sql}) result`,
    ]);
    return JSON.parse(output.trim());
  }
  try {
    attempted = true;
    await docker([
      "run",
      "--detach",
      "--name",
      container,
      "--network",
      "none",
      "--memory",
      "1g",
      "--cpus",
      "2",
      "--tmpfs",
      "/var/lib/postgresql:rw,size=1g",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      "POSTGRES_USER=recovery",
      "-e",
      "POSTGRES_DB=recovery",
      "postgres:18",
    ]);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await exec(["pg_isready", "-U", "recovery", "-d", "recovery"]);
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!ready) throw Error("Isolated PostgreSQL startup failed");
    await exec(
      [
        "pg_restore",
        "-U",
        "recovery",
        "-d",
        "recovery",
        "--no-owner",
        "--no-acl",
        "--exit-on-error",
        "--clean",
        "--if-exists",
      ],
      plaintext(),
    );
    const tables = (
      await query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).map((row) => row.tablename as string);
    const counts: Record<string, string> = {};
    for (const table of tables)
      counts[table] = (
        await query(
          `SELECT count(*)::text AS count FROM public.${quote(table)}`,
        )
      )[0].count;
    const schema = await query(
      "SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
    );
    const constraints = await query(
      "SELECT c.relname AS table_name,con.conname,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,con.conname",
    );
    const indexes = await query(
      "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
    );
    const schemaHash = createHash("sha256")
      .update(
        JSON.stringify({ schema, constraints, indexes }, (key, value) =>
          key === "ordinal_position"
            ? undefined
            : value && typeof value === "object" && !Array.isArray(value)
              ? Object.fromEntries(
                  Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
                )
              : value,
        ),
      )
      .digest("hex");
    if (
      schemaHash !== manifest.schemaHash ||
      JSON.stringify(counts) !== JSON.stringify(manifest.rowCounts)
    )
      throw Error("Restored schema or row counts mismatch");
    let payloadsVerified = 0;
    if (applicationKey)
      for (const [table, context, column] of [
        ["cloud_projects", "project", "id"],
        ["cloud_runs", "run", "id"],
        ["cloud_events", "event", "run_id"],
      ]) {
        if (!tables.includes(table!)) continue;
        for (const row of await query(
          `SELECT ${quote(column!)} AS context_id,payload FROM public.${quote(table!)}`,
        )) {
          const bytes = Buffer.from(row.payload, "base64");
          try {
            const decipher = createDecipheriv(
              "aes-256-gcm",
              applicationKey,
              bytes.subarray(0, 12),
            );
            decipher.setAAD(Buffer.from(`${context}:${row.context_id}`));
            decipher.setAuthTag(bytes.subarray(12, 28));
            const body = Buffer.concat([
              decipher.update(bytes.subarray(28)),
              decipher.final(),
            ]);
            try {
              JSON.parse(body.toString());
            } finally {
              body.fill(0);
            }
            payloadsVerified++;
          } catch {
            throw Error("Restored application payload authentication failed");
          }
        }
      }
    await docker(["rm", "--force", "--volumes", container], undefined, true);
    attempted = false;
    const receipt = {
      status: "verified",
      completedAt: new Date().toISOString(),
      archiveSha256: manifest.sha256,
      schemaHash,
      tableCount: tables.length,
      rowCounts: counts,
      applicationPayloadsVerified: payloadsVerified,
      applicationKeySupplied: Boolean(applicationKey),
      containerRemoved: true,
      sourceDatabaseContacted: false,
    };
    if (args.receipt)
      await writeFile(args.receipt, JSON.stringify(receipt, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
    return receipt;
  } finally {
    archiveKey.fill(0);
    applicationKey?.fill(0);
    try {
      if (attempted)
        await docker(
          ["rm", "--force", "--volumes", container],
          undefined,
          true,
        );
    } finally {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
    }
  }
}
if (import.meta.main) {
  try {
    const values: Record<string, string> = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const flag = process.argv[i];
      const value = process.argv[i + 1];
      if (
        ![
          "--archive",
          "--manifest",
          "--key",
          "--application-key-file",
          "--receipt",
          "--context",
        ].includes(flag!) ||
        !value
      )
        throw Error(
          "Usage: recovery-restore.ts --archive FILE --manifest FILE --key FILE [--application-key-file FILE] [--receipt FILE] [--context colima]",
        );
      values[flag!] = value;
    }
    if (!values["--archive"] || !values["--manifest"] || !values["--key"])
      throw Error("Archive, manifest and key paths are required");
    console.log(
      JSON.stringify(
        await restoreArchive({
          archive: path.resolve(values["--archive"]),
          manifest: path.resolve(values["--manifest"]),
          key: path.resolve(values["--key"]),
          applicationKeyFile: values["--application-key-file"],
          receipt: values["--receipt"],
          context: values["--context"],
        }),
      ),
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Independent restore failed",
    );
    process.exitCode = 1;
  }
}
