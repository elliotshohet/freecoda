import { readdir, readFile } from "node:fs/promises";
import { getPool, transaction } from "../apps/web/lib/db";
const path = new URL("../apps/web/lib/db/migrations/", import.meta.url);
await transaction(async (db) => {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('freecoda:migrations'))",
  );
  await db.query(
    "CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  for (const name of (await readdir(path))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (await db.query("SELECT 1 FROM migrations WHERE name=$1", [name]))
        .rowCount
    )
      continue;
    await db.query(await readFile(new URL(name, path), "utf8"));
    await db.query("INSERT INTO migrations(name) VALUES ($1)", [name]);
    console.log(`Applied ${name}`);
  }
});
await getPool().end();
