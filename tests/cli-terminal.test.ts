import { test, expect } from "bun:test";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  safeTerminalText,
  wrapTerminalText,
  resolveTerminalTheme,
} from "../packages/cli/src/ui";

test("terminal rendering strips clipboard/control escapes and wraps Unicode safely", () => {
  expect(
    safeTerminalText("\x1b]52;c;clipboard-secret\x07hello\x1b[2J\rworld"),
  ).toBe("helloworld");
  expect(wrapTerminalText("ab🙂cd", 4)).toEqual(["ab🙂", "cd"]);
  expect(wrapTerminalText("e\u0301 test", 4)).toEqual(["e\u0301 te", "st"]);
});

test("terminal theme follows explicit preferences and standard foreground/background hints", () => {
  expect(resolveTerminalTheme("dark", "0;7")).toBe("dark");
  expect(resolveTerminalTheme("light", "15;0")).toBe("light");
  expect(resolveTerminalTheme("auto", "0;15")).toBe("light");
  expect(resolveTerminalTheme("auto", "7;0")).toBe("dark");
  expect(resolveTerminalTheme("auto", "invalid")).toBe("dark");
});

const ptyDriver = String.raw`
import os,pty,select,subprocess,sys,time,json,fcntl,termios,struct,signal,re
node,entry,root,config=sys.argv[1:]
master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',30,100,0,0))
env=os.environ.copy()
env.pop('NO_COLOR',None)
for key in list(env):
 if key.startswith(('OPENAI_','AI_GATEWAY_','VERCEL_','GITHUB_','GH_')):env.pop(key,None)
env.update({'TERM':'xterm-256color','FORCE_COLOR':'1','COLORFGBG':'0;7','FREECODA_CONFIG_DIR':config})
child=subprocess.Popen([node,entry,'--cwd',root,'--mode','build'],stdin=slave,stdout=slave,stderr=slave,env=env,close_fds=True)
os.close(slave)
output=b''
def wait_for(text,start=0,timeout=12):
 global output
 until=time.time()+timeout
 while time.time()<until:
  if text.encode() in output[start:]:return
  if child.poll() is not None:raise AssertionError('CLI exited before expected terminal state: '+text+'\n'+output[-2000:].decode(errors='replace'))
  if select.select([master],[],[],.05)[0]:
   try:output+=os.read(master,65536)
   except OSError:break
 raise AssertionError('Missing terminal state: '+text+'\n'+output[-2500:].decode(errors='replace'))
def send(text):
 global output
 os.write(master,text.encode())
 until=time.time()+.12
 while time.time()<until:
  if select.select([master],[],[],.02)[0]:
   try:output+=os.read(master,65536)
   except OSError:break
try:
 wait_for('Your Freecoda conversation')
 start=len(output);send('/permissions');send('\r');wait_for('Permissions · ↑/↓ choose',start)
 send('\x1b[A');send('\r');wait_for('Permissions: Read only',start)
 start=len(output);send('/status');send('\r');wait_for('effective: plan',start)
 start=len(output);send('/permissions full-access');send('\r');wait_for('Permissions: Full access',start)
 start=len(output);send('/permissions');send('\r');wait_for('Permissions · ↑/↓ choose',start)
 send('\x1b');wait_for('Permissions unchanged: Full access',start)
 start=len(output);send('/permissions 2');send('\r');wait_for('Permissions: Default',start)
 assert 'permission' not in json.dumps(json.load(open(os.path.join(config,'config.json')))).lower(),'Session policy persisted to disk'
 send('/');wait_for('Commands ·');send('\x1b[B');send('\r');wait_for('New chat. Previous history is saved; /resume')
 send('/th');wait_for('Choose auto, light, or dark');send('\t');send('light');send('\r');wait_for('Theme: light')
 assert json.load(open(os.path.join(config,'config.json')))['theme']=='light','Theme preference was not saved'
 send('/theme dark');send('\r');wait_for('Theme: dark')
 assert b'\x1b[38;5;55m' in output and b'\x1b[38;5;147m' in output,'Both terminal palettes were not rendered'
 # Bracketed paste can contain slash commands/newlines but must not submit.
 send('\x1b[200~/exit\n/usage\x1b[201~')
 time.sleep(.2)
 assert child.poll() is None,'Pasted slash command exited the application'
 send('\x03') # clear the composer; not an exit while text exists
 fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',16,80,0,0));child.send_signal(signal.SIGWINCH)
 start=len(output);send('Fix addition. Do not run commands.');send('\r')
 wait_for('Allow file changes?',start)
 assert 'a - b' in open(os.path.join(root,'sum.ts')).read(),'Write happened before approval'
 wait_for('2. Yes, allow ALL file edits for this session',start)
 frame=output[start:].split(b'\x1b[H')[-1].decode(errors='replace')
 assert 'a - b' in frame and 'a + b' in frame,'Short terminal hid approval diff evidence'
 assert 'Session approval covers ALL' in frame,'Short terminal hid category warning'
 assert len(frame.split('\r\n'))<=16,'Frame exceeded actual terminal height'
 fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',16,30,0,0));child.send_signal(signal.SIGWINCH)
 wait_for('Resize terminal',len(output))
 send('1');send('\r')
 assert 'a - b' in open(os.path.join(root,'sum.ts')).read(),'Invisible approval was accepted while terminal was too small'
 frame=output.split(b'\x1b[H')[-1].decode(errors='replace')
 clean=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',frame)
 assert all(len(line)<=30 for line in clean.split('\r\n')),'Resize notice exceeded actual width'
 fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',16,80,0,0));child.send_signal(signal.SIGWINCH)
 time.sleep(.1)

 send('\x1b[B');send('\x1b[B');send('\r')
 wait_for('No changes approved',start)
 fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',30,100,0,0));child.send_signal(signal.SIGWINCH)
 assert 'a - b' in open(os.path.join(root,'sum.ts')).read(),'Denied write changed source'
 start=len(output);send('Fix addition. Do not run commands.');send('\r')
 wait_for('Allow file changes?',start)
 send('1');send('\r')
 wait_for('Fixed addition',start)
 wait_for('conversation saved locally',start)
 assert 'a + b' in open(os.path.join(root,'sum.ts')).read(),'Approved write did not change source'
 wait_for('House sponsor fixture')
 start=len(output);send('/new');send('\r');wait_for('New chat. Previous history is saved; /resume',start)
 start=len(output);send('/resume 2');send('\r');wait_for('Resumed task: Fix addition',start)
 start=len(output);send('/mode chat');send('\r');wait_for('Default mode: chat',start)
 start=len(output);send('/status');send('\r');wait_for('Chat has no project access or tools',start);wait_for('Conversation: 0 messages',start)
 start=len(output);send('/resume');send('\r');wait_for('No saved tasks',start)
 start=len(output);send('/mode build');send('\r');wait_for('Default mode: build',start)
 start=len(output);send('/resume');send('\r');wait_for('Fix addition',start)
 send('/exit');send('\r')
 child.wait(timeout=5)
 assert child.returncode==0,'CLI returned a failure'
 assert b'\x1b[?1049l' in output,'Alternate terminal screen was not restored'
 print(json.dumps({'approvalDeniedPreservedFile':True,'approvalAcceptedEditedFile':True,'houseAnnouncementVisible':True,'pasteDidNotSubmit':True,'terminalRestored':True}))
finally:
 if child.poll() is None:child.kill();child.wait()
 os.close(master)
`;

test.skipIf(process.platform === "win32")(
  "real PTY session preserves denied edits, accepts approved edits, renders ads, and restores the terminal",
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "freecoda-terminal-"));
    let root = path.join(directory, "repo");
    const state = path.join(directory, "config");
    await Promise.all([mkdir(root), mkdir(state)]);
    root = await realpath(root);
    await writeFile(
      path.join(root, "sum.ts"),
      "export const sum = (a, b) => a - b;\n",
    );
    let requests = 0,
      impressions = 0,
      usage = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/ads") {
          expect(req.headers.get("authorization")).toBeNull();
          return Response.json({
            id: null,
            sponsor: "Freecoda",
            headline: "House sponsor fixture",
            description: "A fixture announcement, not a paid advertiser.",
            href: "/advertise",
          });
        }
        if (url.pathname.endsWith("/impression")) {
          impressions++;
          return Response.json({ ok: true });
        }
        if (url.pathname.endsWith("/usage")) {
          usage++;
          return Response.json({});
        }
        if (url.pathname != "/v1/chat/completions")
          return new Response("Not found", { status: 404 });
        await req.json();
        const turn = requests++ % 3;
        const tool =
          turn === 0
            ? { name: "read_file", args: { path: "sum.ts" } }
            : turn === 1
              ? {
                  name: "replace_text",
                  args: {
                    path: "sum.ts",
                    search: "a - b",
                    replacement: "a + b",
                  },
                }
              : null;
        const fixed = (
          await readFile(path.join(root, "sum.ts"), "utf8")
        ).includes("a + b");
        const chunks = tool
          ? [
              {
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: "assistant",
                      tool_calls: [
                        {
                          index: 0,
                          id: "call-" + requests,
                          type: "function",
                          function: {
                            name: tool.name,
                            arguments: JSON.stringify(tool.args),
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              },
              {
                choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
              },
            ]
          : [
              {
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: "assistant",
                      content: fixed
                        ? "Fixed addition."
                        : "No changes approved.",
                    },
                    finish_reason: null,
                  },
                ],
              },
              { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
            ];
        return new Response(
          chunks
            .map(
              (chunk) =>
                "data: " +
                JSON.stringify({
                  id: "terminal-fixture",
                  model: "fixture",
                  object: "chat.completion.chunk",
                  ...chunk,
                }) +
                "\n\n",
            )
            .join("") + "data: [DONE]\n\n",
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });
    try {
      await writeFile(
        path.join(state, "config.json"),
        JSON.stringify({
          server: `http://127.0.0.1:${server.port}`,
          provider: {
            baseURL: `http://127.0.0.1:${server.port}/v1`,
            model: "fixture",
          },
          trustedRoots: [root],
        }),
        { mode: 0o600 },
      );
      const build = Bun.spawn([process.execPath, "packages/cli/build.ts"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await build.exited).toBe(0);
      const child = Bun.spawn(
        [
          "python3",
          "-c",
          ptyDriver,
          "node",
          path.resolve("packages/cli/dist/index.js"),
          root,
          state,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [output, error, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0) throw new Error(error || output);
      expect(JSON.parse(output).terminalRestored).toBe(true);
      expect(requests).toBe(6);
      expect(impressions).toBe(0);
      expect(usage).toBe(0);
    } finally {
      await server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  },
  35000,
);
