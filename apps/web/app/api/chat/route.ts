import { browserChat, browserChatStatus } from "@/lib/browser-chat";
import { handle } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const GET = (req: Request) => handle(() => browserChatStatus(req));
export const POST = (req: Request) => handle(() => browserChat(req));
