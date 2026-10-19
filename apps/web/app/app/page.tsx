import { browserEntryPath } from "@/lib/sign-in-return";
import { requireBrowserSession } from "@/lib/browser-session";
import { SessionBoundary } from "@/components/session-boundary";
import { UnifiedWebApp } from "./unified-web-app";

export const metadata = {
  title: "Freecoda",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AppPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const user = await requireBrowserSession(browserEntryPath("/app", params));
  const thread = params.thread;
  return (
    <SessionBoundary userId={user.id}>
      <UnifiedWebApp
        user={{ name: user.name, image: user.image }}
        initialView={params.view === "chat" ? "chat" : params.view === "workspace" || params.project ? "workspace" : "chat"}
        initialThreadId={typeof thread === "string" ? thread : undefined}
      />
    </SessionBoundary>
  );
}
