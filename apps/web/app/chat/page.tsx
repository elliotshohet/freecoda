import { requireBrowserSession } from "@/lib/browser-session";
import { browserEntryPath } from "@/lib/sign-in-return";
import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ChatPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  await requireBrowserSession(browserEntryPath("/chat", params));
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "view" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  query.set("view", "chat");
  redirect(`/app?${query.toString()}`);
}
