import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { ApiError } from "../http";

export const PREVIEW_TICKET_SECONDS = 300;
function previewKey() {
  const secret =
    process.env.CLOUD_PREVIEW_SECRET || process.env.AD_SIGNING_SECRET;
  if (!secret || secret.length < 32)
    throw new ApiError(503, "Preview signing is not configured.");
  const seed = createHash("sha256")
    .update("freecoda:preview-ed25519:v1\0")
    .update(secret)
    .digest();
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      seed,
    ]),
    format: "der",
    type: "pkcs8",
  });
}
export function previewPublicKey() {
  return createPublicKey(previewKey())
    .export({ format: "pem", type: "spki" })
    .toString();
}
export function createPreviewTicket(
  projectId: string,
  sandboxId: string,
  now = Date.now(),
) {
  const expiresAt = now + PREVIEW_TICKET_SECONDS * 1000;
  const body = Buffer.from(
    JSON.stringify({ v: 1, projectId, sandboxId, expiresAt }),
  ).toString("base64url");
  return {
    token: `${body}.${sign(null, Buffer.from(body), previewKey()).toString("base64url")}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}
export function verifyPreviewTicket(
  token: string,
  publicKey: string,
  projectId: string,
  sandboxId: string,
  now = Date.now(),
) {
  try {
    if (token.length > 4096) return false;
    const [body, signature, ...extra] = token.split(".");
    if (
      !body ||
      !signature ||
      extra.length ||
      !verify(
        null,
        Buffer.from(body),
        publicKey,
        Buffer.from(signature, "base64url"),
      )
    )
      return false;
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    return (
      claims.v === 1 &&
      claims.projectId === projectId &&
      claims.sandboxId === sandboxId &&
      Number.isSafeInteger(claims.expiresAt) &&
      claims.expiresAt > now &&
      claims.expiresAt <= now + PREVIEW_TICKET_SECONDS * 1000 + 10_000
    );
  } catch {
    return false;
  }
}

// Runs as the dedicated preview user, never as the project user. Only the
// public verification key enters the VM; private signing/provider keys do not.
export const PREVIEW_PROXY_SOURCE = String.raw`
import http from 'node:http';
import net from 'node:net';
import {readFileSync} from 'node:fs';
import {verify} from 'node:crypto';
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
const COOKIE='__Host-freecoda_preview';
function valid(token){try{
  if(typeof token!=='string'||token.length>4096)return false;
  const [body,sig,...extra]=token.split('.');
  if(!body||!sig||extra.length||!verify(null,Buffer.from(body),config.publicKey,Buffer.from(sig,'base64url')))return false;
  const p=JSON.parse(Buffer.from(body,'base64url').toString());
  return p.v===1&&p.projectId===config.projectId&&p.sandboxId===config.sandboxId&&Number.isSafeInteger(p.expiresAt)&&p.expiresAt>Date.now()&&p.expiresAt<=Date.now()+310000;
}catch{return false;}}
function cookie(req){return (req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);}
function headers(req){
  const result={host:'127.0.0.1:'+config.appPort};
  for(const k of ['accept','accept-language','content-type','content-length','range','if-none-match','if-modified-since','user-agent'])if(req.headers[k])result[k]=req.headers[k];
  return result;
}
const policy="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors https://freecoda.com https://www.freecoda.com http://127.0.0.1:3010; sandbox allow-scripts allow-same-origin allow-forms allow-downloads";
const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  const url=new URL(req.url,'http://preview.invalid');
  const ticket=url.searchParams.get('ticket');
  if(ticket){
    if(!valid(ticket)){res.writeHead(401).end('Preview link expired. Open a fresh preview from Freecoda.');return;}
    url.searchParams.delete('ticket');
    res.setHeader('Set-Cookie',COOKIE+'='+ticket+'; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=300');
    res.writeHead(303,{Location:url.pathname+url.search}).end();return;
  }
  if(!valid(cookie(req))){res.writeHead(401).end('A valid Freecoda preview ticket is required.');return;}
  const upstream=http.request({host:'127.0.0.1',port:config.appPort,path:url.pathname+url.search,method:req.method,headers:headers(req)},response=>{
    for(const name of ['content-type','content-length','etag','last-modified','accept-ranges','content-range'])if(response.headers[name])res.setHeader(name,response.headers[name]);
    res.setHeader('Content-Security-Policy',policy);
    const location=response.headers.location;
    if(location){const target=new URL(location,'http://127.0.0.1:'+config.appPort);if(target.origin!=='http://127.0.0.1:'+config.appPort){response.destroy();res.writeHead(502).end('External preview redirects are disabled.');return;}res.setHeader('Location',target.pathname+target.search);}
    res.writeHead(response.statusCode||502);response.pipe(res);
  });
  let size=0;req.on('data',chunk=>{size+=chunk.length;if(size>2097152){upstream.destroy();req.destroy();}});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('The project preview is starting. Try again shortly.');});
  req.pipe(upstream);
});
server.on('upgrade',(req,socket,head)=>{
  if(!valid(cookie(req))){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
  const url=new URL(req.url,'http://preview.invalid');url.searchParams.delete('ticket');
  const upstream=net.connect(config.appPort,'127.0.0.1',()=>{
    const h={...headers(req),connection:'Upgrade',upgrade:'websocket',origin:'http://127.0.0.1:'+config.appPort};
    for(const k of ['sec-websocket-key','sec-websocket-version','sec-websocket-protocol','sec-websocket-extensions'])if(req.headers[k])h[k]=req.headers[k];
    upstream.write('GET '+url.pathname+url.search+' HTTP/1.1\r\n'+Object.entries(h).map(([k,v])=>k+': '+v).join('\r\n')+'\r\n\r\n');
    if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
});
server.listen(config.port||3000,'0.0.0.0');
`;
