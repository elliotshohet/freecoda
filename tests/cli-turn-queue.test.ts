import { test, expect } from "bun:test";
import { TurnQueue } from "../packages/cli/src/turn-queue";

test("queued turns keep FIFO identity and captured context across stop/retry/removal", () => {
  const queue = new TurnQueue();
  const context = { model: "beam", mode: "chat" };
  const first = queue.add("one", context);
  const second = queue.add("two", { model: "other", mode: "build" });
  expect(queue.next()).toBe(first);
  queue.items.unshift(first);
  queue.paused = true;
  expect(queue.next()).toBeUndefined();
  expect(queue.items.map((item) => item.id)).toEqual([first.id, second.id]);
  queue.remove(second.id.slice(0, 8));
  queue.paused = false;
  expect(queue.next()?.context).toBe(context);
  expect(queue.items).toHaveLength(0);
  expect(() => queue.remove("missing")).toThrow("not found");
  for (let i = 0; i < 20; i++) queue.add(String(i));
  expect(() => queue.add("overflow")).toThrow("full");
});

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("real CLI PTY drains rapid sends in order and pauses queued work after an error", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "freecoda-queue-"));
  const requests: string[] = [];
  let failed = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    if (!new URL(req.url).pathname.endsWith("/chat/completions")) return Response.json({ id: null });
    const body = await req.json() as { messages: {role: string; content: string}[] };
    const prompt = body.messages.filter((message) => message.role === "user").at(-1)!.content;
    requests.push(prompt);
    await Bun.sleep(prompt === "ONE" || prompt === "FAIL" || prompt === "CANCEL" ? 1100 : 80);
    if (prompt === "FAIL" && !failed) { failed = true; return Response.json({ error: { message: "fixture error" } }, { status: 500 }); }
    return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: `DONE_${prompt}` }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  } });
  const driver = String.raw`
import os,pty,select,subprocess,sys,time,fcntl,termios,struct
entry,config=sys.argv[1:]
master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',30,100,0,0))
env=os.environ.copy();env.update({'TERM':'xterm-256color','FREECODA_CONFIG_DIR':config})
child=subprocess.Popen(['node',entry,'--cwd',config],stdin=slave,stdout=slave,stderr=slave,env=env)
os.close(slave);output=b''
def wait(text,start=0):
 global output
 until=time.time()+15
 while time.time()<until:
  if text.encode() in output[start:]:return
  if select.select([master],[],[],.05)[0]:
   try:output+=os.read(master,65536)
   except OSError:break
 raise AssertionError('Missing '+text+' '+output[-2500:].decode(errors='replace'))
def send(text):
 os.write(master,text.encode());time.sleep(.12)
try:
 wait('Your Freecoda conversation')
 send('ONE');send('\r');wait('Working')
 send('TWO');send('\r');send('THREE');send('\r')
 wait('DONE_THREE')
 time.sleep(.3);start=len(output)
 send('FAIL');send('\r');wait('Working',start)
 send('AFTER');send('\r');wait('Queue paused',start)
 # No later queued work runs until explicit resume.
 time.sleep(.4);send('/queue');send('\r');wait('Paused',start)
 start=len(output);send('/queue resume');send('\r');wait('DONE_AFTER',start);wait('conversation saved locally',start);time.sleep(.4)
 start=len(output);send('CANCEL');send('\r');wait('Working',start)
 send('AFTER_CANCEL');send('\r');send('\x1b');wait('Queue paused',start)
 start=len(output);send('/queue resume');send('\r');wait('DONE_AFTER_CANCEL',start);wait('conversation saved locally',start);time.sleep(.4)
 send('/exit');send('\r')
 until=time.time()+6
 while child.poll() is None and time.time()<until:
  if select.select([master],[],[],.05)[0]:
   try:output+=os.read(master,65536)
   except OSError:break
 child.wait(timeout=1)
 assert child.returncode==0
 print('queue PTY passed')
finally:
 if child.poll() is None:child.kill();child.wait()
 os.close(master)
`;
  try {
    await writeFile(path.join(dir, "config.json"), JSON.stringify({ server: server.url.origin, provider: { baseURL: `${server.url.origin}/v1`, model: "fixture" }, trustedRoots: [] }));
    const script = path.join(dir, "driver.py");
    await writeFile(script, driver);
    const process = Bun.spawn(["python3", script, path.resolve("packages/cli/dist/index.js"), dir], { stdout: "pipe", stderr: "pipe" });
    const [output, error] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text()]);
    expect(await process.exited, error).toBe(0);
    expect(output).toContain("queue PTY passed");
    expect(requests).toEqual(["ONE", "TWO", "THREE", "FAIL", "FAIL", "AFTER", "CANCEL", "CANCEL", "AFTER_CANCEL"]);
  } finally { await server.stop(true); await rm(dir, { recursive: true, force: true }); }
}, 40000);
