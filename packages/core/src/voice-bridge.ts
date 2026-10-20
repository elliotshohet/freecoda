import { createServer, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createVoiceController } from "../../contracts/src/voice-browser";

export type VoiceBridgeEvent = { type: "assistant" | "status" | "busy" | "stop"; text?: string; busy?: boolean; turnId?: string };
export type VoiceBridgeControl = "stop" | "interrupt" | "mute" | "unmute";
export type VoiceBridge = { url: string; close(): Promise<void>; publish(event: VoiceBridgeEvent): void };
/** A temporary, authenticated loopback companion. Audio never crosses this server. */
export async function startVoiceBridge(options: {
  title?: string;
  onTranscript(input: { text: string; mode: "dictation" | "conversation"; turnId?: string }): Promise<unknown> | unknown;
  onControl?(action: VoiceBridgeControl, turnId?: string): Promise<unknown> | unknown;
  onClose?(): void;
}): Promise<VoiceBridge> {
  const token = randomBytes(32).toString("hex"), nonce = randomBytes(18).toString("base64");
  let origin = "", host = "", closed = false, lastActivity = Date.now();
  let pending: ServerResponse | undefined;
  const events: VoiceBridgeEvent[] = [];
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin" };
  const respond = (response: ServerResponse, code: number, body: unknown) => {
    response.writeHead(code, { ...headers, "Content-Type": "application/json" }); response.end(JSON.stringify(body));
  };
  const drain = () => { if (pending && events.length) { const response = pending; pending = undefined; respond(response, 200, events.splice(0)); } };
  const publish = (event: VoiceBridgeEvent) => {
    if (closed) return;
    events.push({ type: event.type, ...(typeof event.text === "string" ? { text: event.text.slice(0, 64000) } : {}), ...(typeof event.busy === "boolean" ? { busy: event.busy } : {}), ...(typeof event.turnId === "string" && /^[a-f0-9-]{36}$/.test(event.turnId) ? { turnId: event.turnId } : {}) });
    if (events.length > 32) events.shift(); drain();
  };
  let receiving = false;
  const cancelledTurns = new Set<string>();
  const server = createServer(async (request, response) => {
    if (closed || request.headers.host !== host || (request.headers.origin && request.headers.origin !== origin) || request.headers["sec-fetch-site"] === "cross-site") { respond(response, 403, { error: "Voice companion origin rejected." }); return; }
    const pathname = request.url;
    if (request.method === "GET" && pathname === "/") {
      response.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`, "Permissions-Policy": "microphone=(self)" });
      response.end(companionPage(nonce)); return;
    }
    const credential = request.headers.authorization || "", expected = `Bearer ${token}`;
    const providedBytes = Buffer.from(credential), expectedBytes = Buffer.from(expected);
    if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) { respond(response, 401, { error: "Voice companion authentication required." }); return; }
    lastActivity = Date.now();
    if (request.method === "GET" && pathname === "/events") {
      if (pending) { respond(response, 409, { error: "A voice companion is already connected." }); return; }
      pending = response; drain();
      const timer = setTimeout(() => { if (pending === response) { pending = undefined; respond(response, 200, []); } }, 20000);
      response.on("close", () => { clearTimeout(timer); if (pending === response) pending = undefined; }); return;
    }
    if (request.method !== "POST" || request.headers.origin !== origin || !["/transcript", "/control"].includes(pathname || "")) { respond(response, 403, { error: "Voice request rejected." }); return; }
    try {
      let bytes = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 24000) throw Error("Voice transcript is too long."); chunks.push(Buffer.from(chunk)); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (pathname === "/control") {
        if (!["stop", "interrupt", "mute", "unmute"].includes(body.action)) throw Error("Invalid voice control.");
        const turnId = typeof body.turnId === "string" && /^[a-f0-9-]{36}$/.test(body.turnId) ? body.turnId : undefined;
        if (turnId && (body.action === "stop" || body.action === "interrupt")) {
          cancelledTurns.add(turnId);
          if (cancelledTurns.size > 64) cancelledTurns.delete(cancelledTurns.values().next().value!);
        }
        await options.onControl?.(body.action, turnId); respond(response, 200, { ok: true });
        if (body.action === "stop" && body.close === true) void close();
        return;
      }
      if (receiving) { respond(response, 409, { error: "Wait for the current voice turn." }); return; }
      if (!["dictation", "conversation"].includes(body.mode) || typeof body.text !== "string" || !body.text.trim() || body.text.length > 20000 || body.text.includes("\0")) throw Error("Invalid voice transcript.");
      if (body.mode === "conversation" && (typeof body.turnId !== "string" || !/^[a-f0-9-]{36}$/.test(body.turnId))) throw Error("Invalid voice turn identity.");
      if (cancelledTurns.has(body.turnId)) { respond(response, 409, { error: "This voice turn was already stopped." }); return; }
      receiving = true;
      try { await options.onTranscript({ text: body.text, mode: body.mode, ...(body.mode === "conversation" ? { turnId: body.turnId } : {}) }); respond(response, 200, { ok: true }); }
      finally { receiving = false; }
    } catch (error) { respond(response, 400, { error: error instanceof Error ? error.message.slice(0, 500) : "Voice request failed." }); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw Error("Voice companion could not start.");
  host = `127.0.0.1:${address.port}`; origin = `http://${host}`;
  const started = Date.now();
  const timer = setInterval(() => { if (Date.now() - lastActivity > 10 * 60_000 || Date.now() - started > 60 * 60_000) void close(); }, 30000); timer.unref();
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
    closed = true; clearInterval(timer);
    if (pending) { respond(pending, 200, [{ type: "stop", text: "Voice session closed." }]); pending = undefined; }
    // Closing a companion must also stop its pending conversational request.
    await Promise.race([Promise.resolve().then(() => options.onControl?.("stop")).catch(() => {}), new Promise<void>(resolve => { const timeout = setTimeout(resolve, 1000); timeout.unref(); })]);
    server.closeIdleConnections();
    const stopped = new Promise<void>(resolve => server.close(() => resolve()));
    server.closeAllConnections();
    await stopped;
    events.length = 0;
    options.onClose?.();
    })();
    return closing;
  };
  return { url: `${origin}/#${token}`, publish, close };
}

function companionPage(nonce: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Freecoda voice</title>
<style nonce="${nonce}">:root{color-scheme:light dark;font:17px/1.6 system-ui}body{max-width:680px;margin:10vh auto;padding:24px}h1{font-size:32px;letter-spacing:-1px}button,textarea{font:inherit;border:1px solid #8888;border-radius:9px;padding:10px 14px}button{cursor:pointer;margin:4px}textarea{display:block;width:100%;box-sizing:border-box;min-height:140px;margin:20px 0}small{display:block;opacity:.75}#status{min-height:28px}button:focus-visible,textarea:focus-visible{outline:2px solid currentColor;outline-offset:3px}</style>
<h1>Freecoda voice</h1><p>Speak instead of typing, or have a live conversation with your active Freecoda session.</p><small>Speech recognition and playback use your browser and operating system. Your browser’s speech service may process audio online. Freecoda receives transcript text, never microphone audio. Conversation turns use your current AI connection and existing permissions.</small>
<p><button id="dictate">Start dictation</button><button id="conversation">Start conversation</button><button id="mute">Mute</button><button id="interrupt">Interrupt</button><button id="stop">Stop</button></p><p id="status" role="status">Microphone is off.</p><textarea id="transcript" aria-label="Recognized words" readonly placeholder="Your recognized words appear here"></textarea><p id="answer"></p>
<script nonce="${nonce}">
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);let closed=false,muted=false,resolveTurn,rejectTurn,currentTurnId;
const status=document.getElementById('status'),transcript=document.getElementById('transcript'),answer=document.getElementById('answer');
async function send(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Voice request failed.');return data;}
const createVoiceController=(${createVoiceController.toString()});
const voice=createVoiceController({onState(s){status.textContent=s.error||s.phase;const active=['listening','transcribing','thinking','speaking'].includes(s.phase)||s.muted;document.getElementById('dictate').disabled=active;document.getElementById('conversation').disabled=active;if(s.transcript)transcript.value=s.transcript;},onDictation(text){transcript.value=text;send('/transcript',{text,mode:'dictation'}).then(()=>{status.textContent='Added to your Freecoda draft. Review and send there.';}).catch(e=>status.textContent=e.message);},onTurn(text,signal){transcript.value=text;const turnId=crypto.randomUUID();currentTurnId=turnId;return new Promise((resolve,reject)=>{resolveTurn=resolve;rejectTurn=reject;signal.addEventListener('abort',()=>{reject(Error('Voice turn interrupted.'));if(currentTurnId===turnId){currentTurnId=undefined;resolveTurn=rejectTurn=undefined;}send('/control',{action:'interrupt',turnId}).catch(()=>{});},{once:true});send('/transcript',{text,mode:'conversation',turnId}).catch(error=>{if(currentTurnId===turnId){currentTurnId=undefined;resolveTurn=rejectTurn=undefined;}reject(error);});});},cancelTurn(){if(currentTurnId)send('/control',{action:'interrupt',turnId:currentTurnId}).catch(()=>{});}});
for(const mode of ['dictation','conversation'])document.getElementById(mode==='dictation'?'dictate':'conversation').onclick=()=>voice.start(mode);
document.getElementById('mute').onclick=()=>{muted=!muted;voice.mute(muted);document.getElementById('mute').textContent=muted?'Unmute':'Mute';send('/control',{action:muted?'mute':'unmute'}).catch(e=>status.textContent=e.message);};
document.getElementById('interrupt').onclick=()=>voice.interrupt();document.getElementById('stop').onclick=()=>{voice.stop();send('/control',{action:'stop'}).catch(()=>{});};
async function poll(){while(!closed){try{const response=await fetch('/events',{headers:{Authorization:'Bearer '+token}});if(!response.ok)throw Error('Voice session disconnected.');for(const event of await response.json()){if(event.turnId&&event.turnId!==currentTurnId)continue;if(event.type==='assistant'){if(resolveTurn&&event.turnId===currentTurnId){answer.textContent=event.text||'';resolveTurn(event.text||'');currentTurnId=undefined;resolveTurn=rejectTurn=undefined;}}else if(event.type==='stop'&&(!event.turnId||event.turnId===currentTurnId)){voice.stop();status.textContent=event.text||'Voice session stopped.';}else if(event.text)status.textContent=event.text;}}catch(e){closed=true;voice.stop();status.textContent=e.message;}}}poll();window.addEventListener('pagehide',()=>{const turnId=currentTurnId;closed=true;voice.dispose();fetch('/control',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({action:'stop',close:true,turnId})}).catch(()=>{});});
</script></html>`;
}
