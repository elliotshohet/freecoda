import { getPool } from "../apps/web/lib/db";
import { cleanupExpired } from "../apps/web/lib/security";
await cleanupExpired();
// Pending inference reservations are intentionally not released without provider evidence.
await getPool().end();
console.log(
  "Expired ad events, device requests, and rate limits removed. Usage reservations preserved.",
);
