import { canonicalLocalAuthOrigin } from "@/lib/browser-session";
import { appUrl } from "@/lib/config";

/** Non-secret development metadata; does not create OAuth state or cookies. */
export function GET(request: Request) {
  return Response.json({
    canonicalOrigin: canonicalLocalAuthOrigin(request.headers.get("host"), appUrl()),
  }, { headers: { "Cache-Control": "no-store" } });
}
