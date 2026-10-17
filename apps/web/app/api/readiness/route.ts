import { readinessRoute } from "@/lib/readiness";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
export const GET = readinessRoute;
