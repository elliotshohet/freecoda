import { getPool, transaction } from "../apps/web/lib/db";
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^\S+@\S+\.\S+$/.test(email))
  throw new Error(
    "Usage: bun --env-file=apps/web/.env.local scripts/invite.ts person@example.com",
  );
await transaction(async (db) => {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('freecoda:invitations'))",
  );
  if (
    (await db.query("SELECT 1 FROM invitations WHERE email=$1", [email]))
      .rowCount
  ) {
    console.log("Already invited.");
    return;
  }
  const { rows } = await db.query("SELECT count(*) FROM invitations");
  if (Number(rows[0].count) >= 20)
    throw new Error("Beta is limited to 20 invitations.");
  await db.query("INSERT INTO invitations(email) VALUES($1)", [email]);
  console.log("Invitation saved. No email was sent.");
});
await getPool().end();
