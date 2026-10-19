import { adminMetrics, adminPeriod, requireAdmin } from "../../../../lib/admin";
import { handle, json } from "../../../../lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin(request);
    return json(await adminMetrics(adminPeriod(new URL(request.url).searchParams.get("days"))));
  });
}
