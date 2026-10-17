import { readFile, writeFile, chmod } from "node:fs/promises";
import { getPool } from "../apps/web/lib/db";
if (
  !process.env.DATABASE_URL ||
  !["127.0.0.1", "localhost"].includes(
    new URL(process.env.DATABASE_URL).hostname,
  )
)
  throw new Error("Test setup only supports local PostgreSQL.");
const pool = getPool();
await pool.query("CREATE DATABASE freecoda_test").catch((e) => {
  if (e.code !== "42P04") throw e;
});
const url = new URL(process.env.DATABASE_URL);
url.pathname = "/freecoda_test";
await writeFile(
  ".env.test.local",
  `DATABASE_URL=${url.toString()}\nAD_SIGNING_SECRET=${"local-test-signing-secret-".repeat(3)}\n`,
);
await chmod(".env.test.local", 0o600);
await pool.end();
console.log("Isolated local test database ready.");
