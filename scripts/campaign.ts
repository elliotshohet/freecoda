import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPool } from "../apps/web/lib/db";
const schema = z
  .object({
    sponsor: z.string().trim().min(2).max(60),
    headline: z.string().trim().min(3).max(90),
    description: z.string().trim().min(5).max(180),
    url: z
      .url()
      .refine(
        (v) =>
          new URL(v).protocol === "https:" &&
          !new URL(v).username &&
          !new URL(v).password,
      ),
    placement: z.enum(["web", "terminal", "both"]),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    impressionLimit: z.number().int().min(0),
    active: z.boolean().default(false),
  })
  .strict();
const command = process.argv[2];
if (command === "list") {
  const { rows } = await getPool().query(
    "SELECT id,sponsor,headline,placement,active,starts_at,ends_at,impressions,clicks FROM campaigns ORDER BY created_at DESC",
  );
  console.table(rows);
} else if (command === "inquiries") {
  const { rows } = await getPool().query(
    "SELECT id,business,email,website,message,status,created_at FROM sponsor_inquiries ORDER BY created_at DESC LIMIT 50",
  );
  console.table(rows);
} else if (command === "pause") {
  await getPool().query("UPDATE campaigns SET active=false WHERE id=$1", [
    process.argv[3],
  ]);
  console.log("Campaign paused.");
} else if (command === "create") {
  const file = process.argv[3];
  if (!file) throw new Error("Provide a campaign JSON file.");
  const data = schema.parse(JSON.parse(await readFile(file, "utf8")));
  if (new Date(data.endsAt) <= new Date(data.startsAt))
    throw new Error("Campaign end must follow start.");
  const id = randomUUID();
  await getPool().query(
    "INSERT INTO campaigns(id,sponsor,headline,description,url,placement,starts_at,ends_at,impression_limit,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      id,
      data.sponsor,
      data.headline,
      data.description,
      data.url,
      data.placement,
      data.startsAt,
      data.endsAt,
      data.impressionLimit,
      data.active,
    ],
  );
  console.log(`Campaign ${id} saved (${data.active ? "active" : "draft"}).`);
} else
  throw new Error(
    "Usage: scripts/campaign.ts create <file> | list | pause <id> | inquiries",
  );
await getPool().end();
