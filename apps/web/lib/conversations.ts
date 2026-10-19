import { z } from "zod";
import { conversationWriteSchema, conversationModeSchema, type ConversationRecord, type ConversationSummary } from "@freecoda/contracts";
import { getPool, transaction } from "./db";
import { encrypt, decrypt } from "./cloud/crypto";
import { identity, rateLimit } from "./security";
import { ApiError, json, jsonBody, sameOrigin } from "./http";
const context = (userId: string, id: string) => `conversation:${userId}:${id}`;
type Row = { id: string; mode: "chat" | "coding"; payload: string; title_payload?: string; version: number; updated_at: Date; deleted_at?: Date | null };
function record(userId: string, row: Row): ConversationRecord {
  const payload = decrypt<{ title: string; messages: ConversationRecord["messages"] }>(row.payload, context(userId, row.id));
  return { id: row.id, mode: row.mode, title: payload.title, messages: payload.messages, version: row.version, updatedAt: row.updated_at.toISOString() };
}
export async function backfillCodingConversations(userId: string) {
  let cursor: string | null = null;
  for (;;) {
    const { rows }: { rows: { id: string; payload: string; updated_at: Date }[] } = await getPool().query<{ id: string; payload: string; updated_at: Date }>("SELECT r.id,r.payload,r.updated_at FROM cloud_runs r LEFT JOIN synced_conversations c ON c.user_id=r.user_id AND c.id=r.id WHERE r.user_id=$1 AND r.status IN ('completed','failed','cancelled') AND c.id IS NULL AND ($2::uuid IS NULL OR r.id>$2::uuid) ORDER BY r.id LIMIT 100", [userId, cursor]);
    for (const row of rows) {
      // Owner-filtered run payloads survive project expiry. This never opens a
      // sandbox or imports project artifacts, credentials, or repository trust.
      const payload = decrypt<{ prompt: string; messages?: ConversationRecord["messages"]; conversationId?: string }>(row.payload, `run:${row.id}`);
      const id = payload.conversationId || row.id;
      const title = payload.prompt?.trim().slice(0, 160) || "Coding conversation";
      const messages = payload.messages?.length ? payload.messages : [{ role: "user" as const, content: payload.prompt || "" }];
      try {
        const saved = await saveConversationForOwner(userId, id, { title, mode: "coding", messages, expectedVersion: null });
        await getPool().query("UPDATE synced_conversations SET updated_at=$3 WHERE user_id=$1 AND id=$2 AND version=1 AND updated_at=$4", [userId, id, row.updated_at, saved.updatedAt]);
      } catch (error) {
        // Existing copies and deletion tombstones always win over lazy imports.
        if (!(error instanceof ApiError && [409, 410].includes(error.status))) throw error;
      }
    }
    if (rows.length < 100) return;
    cursor = rows.at(-1)!.id;
  }
}
export async function conversationRoute(req: Request, path: string): Promise<Response | null> {
  if (path !== "conversations" && !path.startsWith("conversations/")) return null;
  const user = await identity(req);
  await rateLimit(`conversations:${user.id}`, 120, 60);
  const url = new URL(req.url);
  if (path === "conversations" && req.method === "GET") {
    const mode = conversationModeSchema.safeParse(url.searchParams.get("mode"));
    if (!mode.success) throw new ApiError(400, "Choose chat or coding conversations.");
    if (mode.data === "coding") await backfillCodingConversations(user.id);
    let cursor: { at: string; id: string } | undefined;
    if (url.searchParams.has("cursor")) {
      try {
        const encoded = url.searchParams.get("cursor")!;
        if (encoded.length > 300) throw new Error();
        cursor = z.object({ at: z.iso.datetime(), id: z.uuid() }).parse(JSON.parse(Buffer.from(encoded, "base64url").toString()));
      } catch { throw new ApiError(400, "Invalid conversation cursor."); }
    }
    const { rows } = await getPool().query<Row>("SELECT id,mode,title_payload,version,updated_at FROM synced_conversations WHERE user_id=$1 AND mode=$2 AND deleted_at IS NULL AND ($3::timestamptz IS NULL OR (updated_at,id)<($3::timestamptz,$4::uuid)) ORDER BY updated_at DESC,id DESC LIMIT 101", [user.id, mode.data, cursor?.at || null, cursor?.id || null]);
    const page = rows.slice(0, 100);
    const conversations: ConversationSummary[] = page.map(row => ({ id: row.id, mode: row.mode, version: row.version, updatedAt: row.updated_at.toISOString(), title: decrypt<{ title: string }>(row.title_payload!, `conversation-summary:${user.id}:${row.id}`).title }));
    const last = page.at(-1);
    return json({ userId: user.id, conversations, hasMore: rows.length > 100, nextCursor: rows.length > 100 && last ? Buffer.from(JSON.stringify({ at: last.updated_at.toISOString(), id: last.id })).toString("base64url") : null });
  }
  const match = /^conversations\/([^/]+)$/.exec(path);
  if (!match || !z.uuid().safeParse(match[1]).success) throw new ApiError(400, "A conversation UUID is required.");
  const id = match[1];
  if (req.method === "GET") {
    const { rows } = await getPool().query<Row>("SELECT id,mode,payload,version,updated_at FROM synced_conversations WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL", [user.id, id]);
    if (!rows[0]) throw new ApiError(404, "Conversation not found.");
    return json({ conversation: record(user.id, rows[0]) });
  }
  if (!["PUT", "DELETE"].includes(req.method)) throw new ApiError(405, "Unsupported conversation method.");
  if (!user.device) sameOrigin(req);
  if (req.method === "DELETE") {
    // Retain an owner-scoped UUID tombstone even for a missing conversation so an
    // offline device cannot upload its stale copy later and resurrect a deletion.
    await transaction(async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`conversation:${user.id}:${id}`]);
      await db.query("INSERT INTO synced_conversations(user_id,id,mode,payload,deleted_at) VALUES($1,$2,'chat',NULL,now()) ON CONFLICT(user_id,id) DO UPDATE SET payload=NULL,title_payload=NULL,deleted_at=now(),updated_at=now(),version=synced_conversations.version+1", [user.id, id]);
    });
    return json({ ok: true });
  }
  const body = await jsonBody(req, conversationWriteSchema, 8_388_608);
  return json({ conversation: await saveConversationForOwner(user.id, id, body) });
}

export async function saveConversationForOwner(userId: string, id: string, input: unknown): Promise<ConversationRecord> {
  if (!z.uuid().safeParse(id).success) throw new ApiError(400, "A conversation UUID is required.");
  const parsed = conversationWriteSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "Invalid conversation fields.");
  const body = parsed.data;
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > 8_388_608) throw new ApiError(413, "Conversation is too large.");
  const payload = encrypt({ title: body.title, messages: body.messages }, context(userId, id));
  const titlePayload = encrypt({ title: body.title }, `conversation-summary:${userId}:${id}`);
  const saved = await transaction(async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`conversation:${userId}:${id}`]);
    const { rows } = await db.query<Row>("SELECT id,mode,payload,version,updated_at,deleted_at FROM synced_conversations WHERE user_id=$1 AND id=$2 FOR UPDATE", [userId, id]);
    const current = rows[0];
    if (current?.deleted_at) throw new ApiError(410, "This conversation was deleted. Keep your offline copy locally or save it as a new conversation.");
    if (current ? current.version !== body.expectedVersion : body.expectedVersion !== null) throw new ApiError(409, "This conversation changed on another device. Reload it before saving.");
    if (current && current.mode !== body.mode) throw new ApiError(409, "Conversation mode cannot change.");
    const result = await db.query<Row>("INSERT INTO synced_conversations(user_id,id,mode,payload,title_payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,id) DO UPDATE SET payload=EXCLUDED.payload,title_payload=EXCLUDED.title_payload,updated_at=now(),version=synced_conversations.version+1 RETURNING id,mode,payload,version,updated_at", [userId, id, body.mode, payload, titlePayload]);
    return result.rows[0];
  });
  return record(userId, saved);
}
