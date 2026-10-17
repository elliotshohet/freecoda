import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getPool, transaction } from "./db";
import { sessionUser } from "./auth";
import { ApiError } from "./http";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const opaque = () => randomBytes(32).toString("base64url");
export async function rateLimit(key: string, limit: number, seconds: number) {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isSafeInteger(seconds) ||
    seconds < 1
  )
    throw new Error("Invalid rate limit");
  const bucket = Math.floor(Date.now() / 1000 / seconds);
  const expiresAt = new Date((bucket + 1) * seconds * 1000);
  const { rows } = await getPool().query(
    "INSERT INTO request_limits(key,bucket,count,expires_at) VALUES($1,$2,1,$3) ON CONFLICT(key,bucket) DO UPDATE SET count=request_limits.count+1 RETURNING count",
    [hash(`${seconds}:${key}`), bucket, expiresAt],
  );
  if (rows[0].count > limit)
    throw new ApiError(429, "Too many requests. Please wait and try again.");
}
export async function cleanupExpired() {
  await getPool().query(
    "DELETE FROM ad_events WHERE expires_at<now()-interval '7 days'; DELETE FROM device_requests WHERE expires_at<now()-interval '1 day'; DELETE FROM request_limits WHERE expires_at<now();",
  );
}
export function clientKey(req: Request) {
  return (
    req.headers.get("x-vercel-forwarded-for")?.split(",")[0] ||
    req.headers.get("x-forwarded-for")?.split(",")[0] ||
    "local"
  );
}
export async function identity(req: Request) {
  const authorization = req.headers.get("authorization");
  if (authorization) {
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (token.length < 32 || token.length > 100)
      throw new ApiError(401, "Sign in to your CLI again.");
    const { rows } = await getPool().query(
      'SELECT d.id AS device_id,u.id,u.email,u.name,u."emailVerified" FROM devices d JOIN "user" u ON u.id=d.user_id WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()',
      [hash(token)],
    );
    if (!rows.length)
      throw new ApiError(401, "Device access expired or was revoked.");
    return { ...rows[0], device: true };
  }
  const user = await sessionUser(req);
  if (!user) throw new ApiError(401, "Sign in to your workspace first.");
  return { ...user, device: false, device_id: undefined };
}
export async function requireInvite(userId: string) {
  const { rows } = await getPool().query(
    'SELECT p.suspended,i.email FROM "user" u LEFT JOIN profiles p ON p.user_id=u.id LEFT JOIN invitations i ON lower(i.email)=lower(u.email) WHERE u.id=$1',
    [userId],
  );
  if (!rows[0]?.email)
    throw new ApiError(
      403,
      "Hosted AI is invite-only during beta. Your account is ready; an invitation is still required.",
    );
  if (rows[0].suspended) throw new ApiError(403, "This account is suspended.");
  await getPool().query(
    "INSERT INTO profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING",
    [userId],
  );
}
export async function startDevice(name: string) {
  const deviceCode = opaque();
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const raw = Array.from(bytes, (b) => charset[b % charset.length]).join("");
  const userCode = raw.slice(0, 4) + "-" + raw.slice(4);
  await getPool().query(
    "INSERT INTO device_requests(id,code_hash,user_code_hash,name,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
    [randomUUID(), hash(deviceCode), hash(userCode), name],
  );
  return { deviceCode, userCode, expiresIn: 600, interval: 5 };
}
export async function approveDevice(code: string, userId: string) {
  await requireInvite(userId);
  const result = await getPool().query(
    "UPDATE device_requests SET user_id=$1 WHERE user_code_hash=$2 AND user_id IS NULL AND consumed_at IS NULL AND expires_at>now() RETURNING id",
    [userId, hash(code)],
  );
  if (!result.rowCount)
    throw new ApiError(
      400,
      "This code expired or has already been approved. Start login again.",
    );
}
export async function pollDevice(deviceCode: string) {
  return transaction(async (db) => {
    const { rows } = await db.query(
      "SELECT * FROM device_requests WHERE code_hash=$1 FOR UPDATE",
      [hash(deviceCode)],
    );
    const row = rows[0];
    if (!row || row.expires_at < new Date() || row.consumed_at)
      throw new ApiError(
        400,
        "Device code expired or was consumed. Start login again.",
      );
    if (row.last_polled_at && Date.now() - row.last_polled_at.getTime() < 4500)
      throw new ApiError(429, "Poll no more than once every five seconds.");
    await db.query(
      "UPDATE device_requests SET last_polled_at=now() WHERE id=$1",
      [row.id],
    );
    if (!row.user_id) return { status: "pending" };
    const token = opaque();
    await db.query(
      "INSERT INTO devices(id,user_id,token_hash,name,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 days')",
      [randomUUID(), row.user_id, hash(token), row.name],
    );
    await db.query("UPDATE device_requests SET consumed_at=now() WHERE id=$1", [
      row.id,
    ]);
    return { status: "approved", token, expiresIn: 2592000 };
  });
}
