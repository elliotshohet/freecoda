import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
export async function GET(request: Request) {
  const auth = getAuth();
  if (!auth)
    return Response.json(
      { error: "Hosted sign-in is not configured." },
      { status: 503 },
    );
  return toNextJsHandler(auth).GET(request);
}
export async function POST(request: Request) {
  const auth = getAuth();
  if (!auth)
    return Response.json(
      { error: "Hosted sign-in is not configured." },
      { status: 503 },
    );
  return toNextJsHandler(auth).POST(request);
}
