import Chat from "./chat";
import { requireBrowserSession } from "@/lib/browser-session";
import { SessionBoundary } from "@/components/session-boundary";
export default async function Page() {
  const user = await requireBrowserSession();
  return <SessionBoundary userId={user.id}><Chat /></SessionBoundary>;
}
