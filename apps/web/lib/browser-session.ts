import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";

export async function requireBrowserSession() {
  const requestHeaders = await headers();
  let user;
  try {
    user = (await getAuth()?.api.getSession({ headers: requestHeaders }))?.user;
  } catch {
    redirect("/?signin=unavailable");
  }
  if (!user) redirect("/?signin=required");
  return user;
}
