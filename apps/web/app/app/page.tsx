import { CloudWorkspace } from "./workspace";
import { requireBrowserSession } from "@/lib/browser-session";
import { SessionBoundary } from "@/components/session-boundary";
export const metadata = {
  title: "Cloud workspace",
  robots: { index: false, follow: false },
};
export default async function AppPage() {
  const user = await requireBrowserSession();
  return (
    <SessionBoundary userId={user.id}>
    <main id="main">
      <CloudWorkspace />
    </main>
    </SessionBoundary>
  );
}
