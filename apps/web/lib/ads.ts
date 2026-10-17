import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getPool, transaction } from "./db";
import { ApiError } from "./http";
import { publicConfig } from "./config";
export type Placement = "web" | "terminal";
const house = {
  id: null,
  sponsor: "Freecoda announcement",
  headline: "Good tools deserve a little room.",
  description:
    "Put your business in front of people who love to build. Help keep Freecoda free.",
  href: "/advertise",
};
function signingKey() {
  const key = process.env.AD_SIGNING_SECRET;
  if (!key || key.length < 32) throw new Error("Ad signing is not configured");
  return key;
}
export function signAd(payload: {
  nonce: string;
  campaign: string;
  expires: number;
}) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", signingKey()).update(body).digest("base64url")}`;
}
export function verifyAd(token: string) {
  try {
    const [body, sig, ...rest] = token.split(".");
    if (rest.length || !body || !sig || token.length > 800) throw new Error();
    const expected = createHmac("sha256", signingKey()).update(body).digest();
    const supplied = Buffer.from(sig, "base64url");
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      throw new Error();
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (
      typeof payload.nonce !== "string" ||
      typeof payload.campaign !== "string" ||
      typeof payload.expires !== "number" ||
      payload.expires < Date.now()
    )
      throw new Error();
    return payload as { nonce: string; campaign: string; expires: number };
  } catch {
    throw new ApiError(400, "This sponsor link has expired. Reload the page.");
  }
}
export async function selectAd(placement: Placement) {
  if (!publicConfig().database || !process.env.AD_SIGNING_SECRET) return house;
  return transaction(async (db) => {
    const { rows } = await db.query(
      "SELECT * FROM campaigns WHERE active AND starts_at<=now() AND ends_at>now() AND placement IN ($1,'both') AND (impression_limit=0 OR impressions<impression_limit) ORDER BY random() LIMIT 1",
      [placement],
    );
    const c = rows[0];
    if (!c) return house;
    const nonce = randomUUID(),
      expires = Date.now() + 15 * 60 * 1000;
    await db.query(
      "INSERT INTO ad_events(nonce,campaign_id,expires_at) VALUES($1,$2,$3)",
      [nonce, c.id, new Date(expires)],
    );
    const token = signAd({ nonce, campaign: c.id, expires });
    return {
      id: c.id,
      sponsor: c.sponsor,
      headline: c.headline,
      description: c.description,
      href: `/api/v1/ads/click?token=${encodeURIComponent(token)}`,
      token,
    };
  });
}
export async function recordAd(token: string, event: "impression" | "click") {
  const payload = verifyAd(token);
  return transaction(async (db) => {
    const { rows } = await db.query(
      "SELECT * FROM campaigns WHERE id=$1 FOR UPDATE",
      [payload.campaign],
    );
    const campaign = rows[0];
    if (!campaign || !campaign.active || campaign.ends_at < new Date())
      throw new ApiError(410, "This campaign has ended.");
    const column = event === "impression" ? "impressed" : "clicked";
    const changed = await db.query(
      `UPDATE ad_events SET ${column}=true WHERE nonce=$1 AND campaign_id=$2 AND expires_at>now() AND ${column}=false RETURNING nonce`,
      [payload.nonce, payload.campaign],
    );
    if (changed.rowCount) {
      const counter = event === "impression" ? "impressions" : "clicks";
      if (
        event !== "impression" ||
        !Number(campaign.impression_limit) ||
        Number(campaign.impressions) < Number(campaign.impression_limit)
      )
        await db.query(
          `UPDATE campaigns SET ${counter}=${counter}+1 WHERE id=$1`,
          [payload.campaign],
        );
    }
    return campaign.url as string;
  });
}
