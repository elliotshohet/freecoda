import { createRequire } from "node:module";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  randomUUID,
} from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  appendFile,
  stat,
  open,
  chmod,
  unlink,
  realpath,
  lstat,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { encryptionReady } from "../apps/web/lib/cloud/crypto";
const { Pool } = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
)("pg") as typeof import("pg");
const requestedContainer = process.argv.indexOf("--container");
const managed = requestedContainer === -1;
const container = managed
  ? `freecoda-restore-drill18-${randomUUID()}`
  : process.argv[requestedContainer + 1];
if (!container || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(container))
  throw new Error("Invalid container name");
const docker = ["--context", "colima", "exec", "-i", container];
let containerCreated = false;
let containerStartupUncertain = false;
const header = Buffer.from("FREECODA-PG-GCM1\n");
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const root = path.resolve(import.meta.dir, "..");
const directory = path.join(root, ".data/recovery");
const keyDirectory = path.resolve(
  process.env.FREECODA_RECOVERY_KEY_DIRECTORY ||
    path.join(root, ".data/recovery-keys"),
);
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};
if (inside(directory, keyDirectory))
  throw new Error(
    "Recovery key directory must be outside the backup directory",
  );
const stamp = new Date().toISOString().replace(/[^0-9]/g, "");
const suffix = randomBytes(5).toString("hex");
const temporaryDatabase = `freecoda_restore_${stamp}_${suffix}`;
if (!/^freecoda_restore_[0-9]+_[a-f0-9]{10}$/.test(temporaryDatabase))
  throw new Error("Invalid isolated database name");
const backup = path.join(directory, `${temporaryDatabase}.dump.aesgcm`);
const keyFile = path.join(keyDirectory, `${temporaryDatabase}.key`);
const manifestFile = path.join(directory, `${temporaryDatabase}.json`);
let stage = "configuration",
  created = false,
  success = false;
let source: InstanceType<typeof Pool> | undefined;
let restored: LocalDatabase | undefined;
let admin: LocalDatabase | undefined;
type Database = {
  query(sql: string): Promise<{ rows: Record<string, any>[] }>;
};
class LocalDatabase implements Database {
  constructor(private readonly database: string) {}
  async query(sql: string) {
    const select = /^(?:SELECT|SHOW)\b/i.test(sql);
    const query =
      sql === "SHOW server_version_num"
        ? "SELECT current_setting('server_version_num') AS server_version_num"
        : sql;
    const statement = select
      ? `SELECT coalesce(json_agg(row_to_json(result)), '[]'::json) FROM (${query}) result`
      : query;
    const run = command(
      [
        "psql",
        "--username",
        "freecoda_restore",
        "--dbname",
        this.database,
        "--no-psqlrc",
        "--no-align",
        "--tuples-only",
        "--set",
        "ON_ERROR_STOP=1",
        "--command",
        statement,
      ],
      "",
    );
    let output = "";
    for await (const chunk of run.child.stdout) output += chunk.toString();
    await run.completed;
    return { rows: select ? JSON.parse(output.trim()) : [] };
  }
  async end() {}
}
async function control(args: string[], env?: NodeJS.ProcessEnv) {
  const child = spawn("docker", ["--context", "colima", ...args], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
  child.once("close", () => {
    children.delete(child);
    clearTimeout(timeout);
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  let diagnostic = "";
  child.stderr.on("data", (chunk) => {
    if (diagnostic.length < 16000)
      diagnostic += chunk.toString().slice(0, 16000 - diagnostic.length);
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", () => reject(new Error("Container operation failed")));
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            Object.assign(new Error("Container operation failed"), {
              code: /No such container|No such object/i.test(diagnostic)
                ? "CONTAINER_MISSING"
                : "CONTAINER_CONTROL_FAILED",
            }),
          ),
    );
  });
  return output;
}
const children = new Set<ReturnType<typeof spawn>>();
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  for (const child of children) child.kill("SIGKILL");
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
function command(args: string[], input?: string, env?: NodeJS.ProcessEnv) {
  if (interrupted) throw new Error("Recovery drill interrupted");
  const execOptions: string[] = [];
  while (args[0] === "-e") execOptions.push(...args.splice(0, 2));
  const child = spawn(
    "docker",
    [...docker.slice(0, -1), ...execOptions, docker.at(-1)!, ...args],
    {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  children.add(child);
  // A utility may exit before reading its passfile/stdin. Completion handles
  // that failure; an unhandled EPIPE must not bypass isolated resource cleanup.
  child.stdin.on("error", () => {});
  let diagnosticBytes = 0;
  let diagnostic = "";
  child.stderr.on("data", (chunk) => {
    diagnosticBytes += chunk.length;
    if (diagnostic.length < 16000)
      diagnostic += chunk.toString().slice(0, 16000 - diagnostic.length);
  }); // Never print server diagnostics or data.
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", () => {
      clearTimeout(timeout);
      children.delete(child);
      reject(new Error("Docker execution failed"));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      children.delete(child);
      if (code === 0) resolve();
      else
        reject(
          Object.assign(
            new Error(
              `Database utility failed (${code}; ${diagnosticBytes} diagnostic bytes withheld)`,
            ),
            {
              code: /already exists/i.test(diagnostic)
                ? "OBJECT_ALREADY_EXISTS"
                : /permission denied/i.test(diagnostic)
                  ? "PERMISSION_DENIED"
                  : /role .* does not exist/i.test(diagnostic)
                    ? "MISSING_ROLE"
                    : /authentication failed/i.test(diagnostic)
                      ? "AUTHENTICATION_FAILED"
                      : /SSL|certificate/i.test(diagnostic)
                        ? "TLS_FAILED"
                        : "DATABASE_UTILITY_FAILED",
            },
          ),
        );
    });
  });
  if (input !== undefined) child.stdin.end(input);
  return { child, completed };
}
async function inventory(pool: Database, client?: import("pg").PoolClient) {
  const db = client || pool;
  const tables = (
    await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows.map((row) => row.tablename as string);
  const counts: Record<string, string> = {};
  for (const table of tables)
    counts[table] = (
      await db.query(
        `SELECT count(*)::text AS count FROM public.${quote(table)}`,
      )
    ).rows[0].count;
  const schema = (
    await db.query(
      "SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
    )
  ).rows;
  const constraints = (
    await db.query(
      "SELECT c.relname AS table_name,con.conname,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,con.conname",
    )
  ).rows;
  const indexes = (
    await db.query(
      "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
    )
  ).rows;
  return {
    counts,
    metadata: { schema, constraints, indexes },
    schemaHash: createHash("sha256")
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
      .digest("hex"),
    tables: tables.length,
  };
}
try {
  let retainedArchiveKey: Buffer | undefined;
  if (process.env.FREECODA_RECOVERY_ARCHIVE_KEY_FILE) {
    stage = "retained archive key validation";
    const master = path.resolve(process.env.FREECODA_RECOVERY_ARCHIVE_KEY_FILE);
    const info = await lstat(master);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      info.size !== 32 ||
      inside(directory, master) ||
      inside(keyDirectory, master)
    )
      throw new Error(
        "Master archive key must be a separate owner-only32byte file",
      );
    const actual = await realpath(master);
    if (inside(directory, actual) || inside(keyDirectory, actual))
      throw new Error("Master archive key overlaps retained artifacts");
    retainedArchiveKey = await readFile(master);
  }
  const fixtureProject = process.env.FREECODA_RECOVERY_VERIFY_PROJECT_ID;
  const fixturePath = process.env.FREECODA_RECOVERY_VERIFY_PATH;
  const fixtureHash = process.env.FREECODA_RECOVERY_VERIFY_SHA256;
  const verifyFixture = Boolean(fixtureProject || fixturePath || fixtureHash);
  if (
    verifyFixture &&
    (!fixtureProject ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        fixtureProject,
      ) ||
      !fixturePath ||
      fixturePath.length > 500 ||
      !fixtureHash ||
      !/^[a-f0-9]{64}$/.test(fixtureHash))
  )
    throw new Error("Invalid expected recovery fixture");
  if (verifyFixture && !encryptionReady()) {
    stage = "retained cloud encryption key validation";
    throw new Error(
      "The retained production cloud encryption key is required for fixture verification",
    );
  }
  const production = new URL(process.env.DATABASE_URL || "");
  if (!production.hostname.endsWith(".neon.tech"))
    throw new Error("Production source must be the existing Neon database");
  production.hostname = production.hostname.replace("-pooler.", ".");
  production.searchParams.set("sslmode", "verify-full");
  source = new Pool({
    connectionString: production.toString(),
    max: 1,
    connectionTimeoutMillis: 10000,
    query_timeout: 120000,
  });
  if (managed) {
    stage = "isolated PostgreSQL18 container creation";
    containerStartupUncertain = true;
    await control(
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        container,
        "--memory",
        "512m",
        "--cpus",
        "1",
        "--tmpfs",
        "/var/lib/postgresql:rw,nosuid,size=512m",
        "-e",
        "POSTGRES_PASSWORD",
        "-e",
        "POSTGRES_USER",
        "-e",
        "POSTGRES_DB",
        "postgres:18-alpine",
      ],
      {
        POSTGRES_PASSWORD: randomBytes(32).toString("base64url"),
        POSTGRES_USER: "freecoda_restore",
        POSTGRES_DB: "postgres",
      },
    );
    containerCreated = true;
    containerStartupUncertain = false;
  }
  admin = new LocalDatabase("postgres");
  for (let attempt = 0; ; attempt++) {
    try {
      // The official image briefly exposes a temporary Unix-socket-only server
      // during initdb. TCP readiness waits for the final server after restart.
      const ready = command(
        [
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "freecoda_restore",
          "-d",
          "postgres",
        ],
        "",
      );
      ready.child.stdout.resume();
      await ready.completed;
      await admin.query("SELECT 1 AS ready");
      break;
    } catch {
      if (attempt >= 59) throw new Error("Isolated PostgreSQL is not ready");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  stage = "production server version check";
  const productionVersion = Number(
    (await source.query("SHOW server_version_num")).rows[0].server_version_num,
  );
  stage = "local server version check";
  const localVersion = Number(
    (await admin.query("SHOW server_version_num")).rows[0].server_version_num,
  );
  stage = "PostgreSQL client compatibility check";
  const version = command(["pg_dump", "--version"], "");
  let clientVersion = "";
  for await (const chunk of version.child.stdout)
    clientVersion += chunk.toString();
  await version.completed;
  console.log(
    JSON.stringify({
      productionVersion,
      localVersion,
      clientVersion: clientVersion.trim(),
    }),
  );
  if (
    Math.floor(productionVersion / 10000) !== 18 ||
    Math.floor(localVersion / 10000) !== 18 ||
    !/PostgreSQL\) 18\./.test(clientVersion)
  )
    throw new Error(
      `PostgreSQL client/server version is incompatible (source ${productionVersion}, local ${localVersion})`,
    );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(keyDirectory, { recursive: true, mode: 0o700 });
  if (inside(await realpath(directory), await realpath(keyDirectory)))
    throw new Error("Recovery key directory resolves inside backup directory");
  await chmod(directory, 0o700);
  await chmod(keyDirectory, 0o700);
  const key = retainedArchiveKey || randomBytes(32),
    iv = randomBytes(12);
  await writeFile(keyFile, key, { mode: 0o600, flag: "wx" });
  const snapshotClient = await source.connect();
  let expected: Awaited<ReturnType<typeof inventory>>;
  try {
    stage = "read-only snapshot";
    await snapshotClient.query(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const snapshot = (
      await snapshotClient.query("SELECT pg_export_snapshot() AS snapshot")
    ).rows[0].snapshot as string;
    expected = await inventory(source, snapshotClient);
    const fields = [
      production.hostname,
      production.port || "5432",
      decodeURIComponent(production.pathname.slice(1)),
      decodeURIComponent(production.username),
      decodeURIComponent(production.password),
    ];
    if (fields.some((field) => /[\r\n]/.test(field)))
      throw new Error("Unsupported passfile field");
    const passline =
      fields
        .map((field) => field.replaceAll("\\", "\\\\").replaceAll(":", "\\:"))
        .join(":") + "\n";
    const script =
      'set -eu; passfile=$(mktemp /dev/shm/freecoda-pgpass.XXXXXX); chmod 600 "$passfile"; trap \'rm -f "$passfile"\' EXIT; IFS= read -r entry; printf "%s\\n" "$entry" > "$passfile"; export PGPASSFILE="$passfile"; pg_dump "$@"';
    stage = "encrypted dump";
    const dump = command(
      [
        "-e",
        "PGHOST",
        "-e",
        "PGPORT",
        "-e",
        "PGDATABASE",
        "-e",
        "PGUSER",
        "-e",
        "PGSSLMODE",
        "-e",
        "PGSSLROOTCERT",
        "-e",
        "PGCONNECT_TIMEOUT",
        "sh",
        "-c",
        script,
        "freecoda-dump",
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--schema=public",
        `--snapshot=${snapshot}`,
      ],
      passline,
      {
        PGHOST: fields[0],
        PGPORT: fields[1],
        PGDATABASE: fields[2],
        PGUSER: fields[3],
        PGSSLMODE: "verify-full",
        PGSSLROOTCERT: "system",
        PGCONNECT_TIMEOUT: "20",
      },
    );
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(header);
    const output = createWriteStream(backup, { flags: "wx", mode: 0o600 });
    output.write(Buffer.concat([header, iv]));
    await Promise.all([
      pipeline(dump.child.stdout, cipher, output),
      dump.completed,
    ]);
    await appendFile(backup, cipher.getAuthTag());
    await snapshotClient.query("COMMIT");
  } finally {
    await snapshotClient.query("ROLLBACK").catch(() => {});
    snapshotClient.release();
  }
  stage = "isolated database creation";
  await admin.query(
    `CREATE DATABASE ${quote(temporaryDatabase)} TEMPLATE template0`,
  );
  created = true;
  restored = new LocalDatabase(temporaryDatabase);
  stage = "authenticated encrypted restore";
  const info = await stat(backup),
    handle = await open(backup, "r");
  const tag = Buffer.alloc(16);
  const storedHeader = Buffer.alloc(header.length),
    storedIV = Buffer.alloc(12);
  await handle.read(storedHeader, 0, header.length, 0);
  await handle.read(storedIV, 0, 12, header.length);
  await handle.read(tag, 0, 16, info.size - 16);
  await handle.close();
  if (!storedHeader.equals(header))
    throw new Error("Invalid encrypted backup header");
  const storedKey = await readFile(keyFile);
  const decipher = createDecipheriv("aes-256-gcm", storedKey, storedIV);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  // Local peer/trust access uses the existing container's database user, no production credentials.
  const restore = command([
    "pg_restore",
    "--username",
    "freecoda_restore",
    "--dbname",
    temporaryDatabase,
    "--no-owner",
    "--no-acl",
    "--exit-on-error",
    "--clean",
    "--if-exists",
  ]);
  restore.child.stdout.resume();
  await Promise.all([
    pipeline(
      createReadStream(backup, {
        start: header.length + 12,
        end: info.size - 17,
      }),
      decipher,
      restore.child.stdin,
    ),
    restore.completed,
  ]);
  stage = "schema and count verification";
  const actual = await inventory(restored);
  if (
    actual.schemaHash !== expected!.schemaHash ||
    JSON.stringify(actual.counts) !== JSON.stringify(expected!.counts)
  ) {
    console.log(
      JSON.stringify({
        schemaMatches: actual.schemaHash === expected!.schemaHash,
        sourceTableCount: expected!.tables,
        restoredTableCount: actual.tables,
        differingCountTables: Object.keys(expected!.counts).filter(
          (table) => actual.counts[table] !== expected!.counts[table],
        ),
      }),
    );
    const differences: unknown[] = [];
    for (const part of ["schema", "constraints", "indexes"] as const) {
      const sourceRows = expected!.metadata[part],
        targetRows = actual.metadata[part];
      for (let i = 0; i < sourceRows.length; i++) {
        for (const field of Object.keys(sourceRows[i])) {
          const a = sourceRows[i][field],
            b = targetRows[i]?.[field];
          if (JSON.stringify(a) !== JSON.stringify(b))
            differences.push({
              part,
              row: i,
              field,
              sourceType: typeof a,
              restoredType: typeof b,
            });
        }
      }
    }
    console.log(
      JSON.stringify({ metadataDifferences: differences.slice(0, 25) }),
    );
    throw new Error("Restored schema or row counts differ");
  }
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(backup)) digest.update(chunk);
  let encryptedPayloadsVerified = 0;
  stage = "encrypted application payload verification";
  const { decrypt } = await import("../apps/web/lib/cloud/crypto");
  for (const [table, context, idColumn] of [
    ["cloud_projects", "project", "id"],
    ["cloud_runs", "run", "id"],
    ["cloud_events", "event", "run_id"],
  ]) {
    if (verifyFixture && table === "cloud_projects") continue;
    const rows = (
      await restored.query(
        `SELECT ${idColumn} AS context_id,payload FROM public.${quote(table)} LIMIT 1`,
      )
    ).rows;
    for (const row of rows) {
      decrypt(row.payload, `${context}:${row.context_id}`);
      encryptedPayloadsVerified++;
    }
  }
  let expectedFixtureVerified = false;
  if (verifyFixture) {
    const rows = (
      await restored.query(
        `SELECT id,payload FROM public.cloud_projects WHERE id='${fixtureProject}'::uuid`,
      )
    ).rows;
    if (rows.length !== 1)
      throw new Error("Expected restored project is missing");
    const body = decrypt<{
      files?: { path: string; content: string; encoding?: string }[];
    }>(rows[0].payload, `project:${rows[0].id}`);
    const file = body.files?.find((file) => file.path === fixturePath);
    if (
      !file ||
      file.encoding === "base64" ||
      createHash("sha256").update(file.content).digest("hex") !== fixtureHash
    )
      throw new Error("Restored fixture content does not match");
    expectedFixtureVerified = true;
    encryptedPayloadsVerified++;
  }
  await restored.end();
  restored = undefined;
  await admin.query(`DROP DATABASE ${quote(temporaryDatabase)}`);
  created = false;
  if (containerCreated) {
    await control(["rm", "--force", "--volumes", container]);
    containerCreated = false;
  }
  const completedAt = new Date();
  await writeFile(
    manifestFile,
    JSON.stringify(
      {
        completedAt: completedAt.toISOString(),
        retentionExpiresAt: new Date(
          completedAt.getTime() + 7 * 24 * 60 * 60_000,
        ).toISOString(),
        status: "verified",
        productionVersion,
        localVersion,
        clientVersion: clientVersion.trim(),
        encryptedBackup: path.basename(backup),
        keyFile: path.relative(directory, keyFile),
        encryptedBytes: info.size,
        sha256: digest.digest("hex"),
        schemaHash: expected!.schemaHash,
        encryptedPayloadsVerified,
        expectedFixtureVerified,
        containerRemoved: managed,
        tableCount: actual.tables,
        rowCounts: actual.counts,
        temporaryDatabaseDropped: true,
        scope: "public application schema; no roles/ownership/ACL restore",
        schemaNormalization:
          "relative column order preserved; dropped-column ordinal gaps ignored",
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );

  success = true;
  console.log(
    JSON.stringify({
      status: "verified",
      encryptedPayloadsVerified,
      expectedFixtureVerified,
      containerRemoved: managed,
      tableCount: actual.tables,
      encryptedBytes: info.size,
      temporaryDatabaseDropped: true,
      receipt: path.relative(root, manifestFile),
    }),
  );
} catch (error) {
  const code = (error as { code?: unknown }).code;
  console.error(
    `Recovery drill failed during ${stage}${typeof code === "string" && /^[A-Z0-9_]{1,30}$/.test(code) ? ` (${code})` : ""}. Database diagnostics withheld to protect credentials and stored content.`,
  );
  process.exitCode = 1;
} finally {
  interrupted = false; // Permit only the isolated cleanup commands after cancellation.
  for (const child of children) child.kill("SIGKILL");
  await restored?.end().catch(() => {});
  if (created && admin) {
    try {
      await admin.query(
        `DROP DATABASE ${quote(temporaryDatabase)} WITH (FORCE)`,
      );
    } catch {
      console.error(
        "Isolated recovery database cleanup needs attention; see the generated freecoda_restore_ name in the private recovery directory.",
      );
      process.exitCode = 1;
    }
  }
  if (containerCreated || (managed && containerStartupUncertain)) {
    await control(["rm", "--force", "--volumes", container]).catch((error) => {
      if (error.code === "CONTAINER_MISSING") return;
      console.error("Isolated recovery container cleanup failed.");
      process.exitCode = 1;
    });
  }
  await source?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (!success) {
    await Promise.all(
      [backup, keyFile, manifestFile].map((filename) =>
        unlink(filename).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        }),
      ),
    );
    console.error(
      "No production mutations were issued. Failed-attempt backup/key files were removed.",
    );
  }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
