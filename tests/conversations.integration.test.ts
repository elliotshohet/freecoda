import { test, expect, beforeAll, afterAll } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { getPool } from "../apps/web/lib/db";
import { hash } from "../apps/web/lib/security";
import { handle } from "../apps/web/lib/http";
import { conversationRoute } from "../apps/web/lib/conversations";
import { encrypt } from "../apps/web/lib/cloud/crypto";
const pool=getPool();
const userId=randomUUID(),otherId=randomUUID();
const token=randomBytes(32).toString("hex"),otherToken=randomBytes(32).toString("hex");
const id=randomUUID();
const body=(expectedVersion:number|null,title="Synced private title")=>({title,mode:"chat",messages:[{role:"user",content:"private conversation text"}],expectedVersion});
const request=(method:string,path:string,body?:unknown,auth=token)=>handle(async()=>(await conversationRoute(new Request(`https://freecoda.com/api/v1/${path}`,{method,headers:{Authorization:`Bearer ${auth}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})}),path.split("?")[0]))!);
beforeAll(async()=>{
 if((await pool.query("SELECT current_database() name")).rows[0].name!=="freecoda_test")throw new Error("Refusing non-test database");
 process.env.CLOUD_ENCRYPTION_KEY=randomBytes(32).toString("base64");
 for(const [user,auth]of[[userId,token],[otherId,otherToken]]){
  await pool.query('INSERT INTO "user"(id,name,email)VALUES($1,$2,$3)',[user,"Conversation fixture",`${user}@example.test`]);
  await pool.query("INSERT INTO devices(id,user_id,token_hash,name,expires_at)VALUES($1,$2,$3,'fixture',now()+interval '1 day')",[randomUUID(),user,hash(auth)]);
 }
});
afterAll(async()=>{await pool.query('DELETE FROM "user" WHERE id=ANY($1)',[[userId,otherId]]);await pool.end();});
test("conversation round trips with encrypted title and content and stable account identity",async()=>{
 const response=await request("PUT",`conversations/${id}`,body(null));expect(response.status).toBe(200);
 expect((await response.json()).conversation.version).toBe(1);
 const stored=(await pool.query("SELECT payload FROM synced_conversations WHERE user_id=$1 AND id=$2",[userId,id])).rows[0].payload;
 expect(stored).not.toContain("private conversation text");expect(stored).not.toContain("Synced private title");
 expect((await(await request("GET",`conversations/${id}`)).json()).conversation.messages).toEqual(body(null).messages);
 const list=await(await request("GET","conversations?mode=chat")).json();expect(list.userId).toBe(userId);expect(list.conversations[0].id).toBe(id);expect(list.nextCursor).toBeNull();
 expect((await request("GET",`conversations/${id}`,undefined,otherToken)).status).toBe(404);
 expect((await(await request("GET","conversations?mode=chat",undefined,otherToken)).json()).conversations).toEqual([]);
});
test("simultaneous writes preserve one winner and reject stale updates",async()=>{
 const results=await Promise.all([request("PUT",`conversations/${id}`,body(1,"First")),request("PUT",`conversations/${id}`,body(1,"Second"))]);
 expect(results.map(result=>result.status).sort()).toEqual([200,409]);
 expect((await(await request("GET",`conversations/${id}`)).json()).conversation.version).toBe(2);
 expect((await request("PUT",`conversations/${id}`,body(null))).status).toBe(409);
 expect((await request("PUT",`conversations/${id}`,{...body(2),mode:"coding"})).status).toBe(409);
});
test("deletion removes encrypted payload and tombstones prevent offline resurrection",async()=>{
 expect((await request("DELETE",`conversations/${id}`)).status).toBe(200);
 expect((await request("GET",`conversations/${id}`)).status).toBe(404);
 expect((await request("PUT",`conversations/${id}`,body(2))).status).toBe(410);
 expect((await request("PUT",`conversations/${id}`,body(null))).status).toBe(410);
 expect((await pool.query("SELECT payload FROM synced_conversations WHERE user_id=$1 AND id=$2",[userId,id])).rows[0].payload).toBeNull();
 const missing=randomUUID();await request("DELETE",`conversations/${missing}`);expect((await request("PUT",`conversations/${missing}`,body(null))).status).toBe(410);
});
test("strips provider metadata and credential fields while preserving structured tool context",async()=>{
 const toolId=randomUUID();
 const messages=[{role:"assistant",providerMetadata:{secret:"raw"},content:[{type:"tool-call",toolCallId:"call1",toolName:"read_file",input:{path:"app.ts",apiKey:"secret-key",headers:{Authorization:"secret"}}}]},{role:"tool",content:[{type:"tool-result",toolCallId:"call1",toolName:"read_file",output:{type:"text",value:"source text"}}]}];
 const response=await request("PUT",`conversations/${toolId}`,{...body(null),mode:"coding",messages});expect(response.status).toBe(200);
 const text=JSON.stringify(await response.json());expect(text).not.toContain("raw");expect(text).not.toContain("secret-key");expect(text).not.toContain("Authorization");expect(text).toContain("source text");
});
test("pagination returns every conversation across equal-timestamp pages without hidden truncation",async()=>{
 await pool.query("DELETE FROM synced_conversations WHERE user_id=$1",[otherId]);
 const stamp="2026-10-19T12:00:00.123Z";
 for(let index=0;index<103;index++){
  const item=randomUUID();await pool.query("INSERT INTO synced_conversations(user_id,id,mode,payload,updated_at,title_payload)VALUES($1,$2,'chat',$3,$4,$5)",[otherId,item,encrypt({title:`Item ${index}`,messages:[]},`conversation:${otherId}:${item}`),stamp,encrypt({title:`Item ${index}`},`conversation-summary:${otherId}:${item}`)]);
 }
 const first=await(await request("GET","conversations?mode=chat",undefined,otherToken)).json();expect(first.conversations.length).toBe(100);expect(first.hasMore).toBe(true);
 const second=await(await request("GET",`conversations?mode=chat&cursor=${encodeURIComponent(first.nextCursor)}`,undefined,otherToken)).json();expect(second.conversations.length).toBe(3);expect(second.nextCursor).toBeNull();
 expect(new Set([...first.conversations,...second.conversations].map(item=>item.id)).size).toBe(103);
});
test("rejects invalid modes, oversized transcripts and revoked device tokens",async()=>{
 expect((await request("GET","conversations?mode=invalid")).status).toBe(400);
 expect((await request("PUT",`conversations/${randomUUID()}`,{...body(null),messages:[{role:"user",content:"x".repeat(8_388_608)}]})).status).toBe(413);
 expect((await request("PUT",`conversations/${randomUUID()}`,{...body(null),messages:Array.from({length:501},()=>({role:"user",content:"x"}))})).status).toBe(400);
 await pool.query("UPDATE devices SET revoked_at=now() WHERE token_hash=$1",[hash(otherToken)]);expect((await request("GET","conversations?mode=chat",undefined,otherToken)).status).toBe(401);
});

test("existing multi-megabyte conversation syncs without clipping content", async () => {
 const longText="Original transcript ".repeat(220_000);
 const response=await request("PUT",`conversations/${randomUUID()}`,{...body(null),messages:[{role:"user",content:longText}]});
 expect(response.status).toBe(200);
 const saved=(await response.json()).conversation;
 expect(saved.messages[0].content).toBe(longText);
 expect((await(await request("GET",`conversations/${saved.id}`)).json()).conversation.messages[0].content.length).toBe(longText.length);
});
test("existing expired cloud workspace runs backfill once without reviving deleted conversations", async () => {
 const projectId=randomUUID(),runId=randomUUID(),otherRunId=randomUUID();
 await pool.query("INSERT INTO cloud_projects(id,user_id,name,status,payload,expires_at)VALUES($1,$2,'Expired project','ready',$3,now()-interval '1 day')",[projectId,userId,encrypt({},`project:${projectId}`)]);
 for(const [run,owner] of [[runId,userId],[otherRunId,otherId]]) await pool.query("INSERT INTO cloud_runs(id,project_id,user_id,status,payload)VALUES($1,$2,$3,'completed',$4)",[run,projectId,owner,encrypt({prompt:"Original web coding question",mode:"build",messages:[{role:"user",content:"Original web coding question"},{role:"assistant",content:"Original coding answer"}]},`run:${run}`)]);
 const list=await(await request("GET","conversations?mode=coding")).json();
 expect(list.conversations.some((item: { id: string })=>item.id===runId)).toBe(true);
 expect(list.conversations.some((item: { id: string })=>item.id===otherRunId)).toBe(false);
 const restored=(await(await request("GET",`conversations/${runId}`)).json()).conversation;
 expect(restored.messages[1].content).toBe("Original coding answer");
 expect(restored.version).toBe(1);
 await request("DELETE",`conversations/${runId}`);
 const afterDelete=await(await request("GET","conversations?mode=coding")).json();
 expect(afterDelete.conversations.some((item: { id: string })=>item.id===runId)).toBe(false);
 expect((await request("GET",`conversations/${runId}`)).status).toBe(404);
 await pool.query("DELETE FROM cloud_projects WHERE id=$1",[projectId]);
});
