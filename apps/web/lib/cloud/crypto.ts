import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { ApiError } from "../http";
export function encryptionReady() {
  try {
    return (
      Buffer.from(process.env.CLOUD_ENCRYPTION_KEY || "", "base64").length ===
      32
    );
  } catch {
    return false;
  }
}
function key() {
  if (!encryptionReady())
    throw new ApiError(503, "Cloud workspace encryption is not configured.");
  return Buffer.from(process.env.CLOUD_ENCRYPTION_KEY!, "base64");
}
export function encrypt(value: unknown, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
export function decrypt<T>(value: string, context: string): T {
  const bytes = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(
      "utf8",
    ),
  );
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
