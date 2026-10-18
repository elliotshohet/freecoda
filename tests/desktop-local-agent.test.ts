import { test, expect } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalAgentService } from "../apps/desktop/src/local-agent";
import type { DesktopEvent } from "../apps/desktop/src/shared";
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-desktop-"));
  const repository = path.join(root, "repository"),
    data = path.join(root, "desktop-state");
  await mkdir(repository);
  await writeFile(
    path.join(repository, "answer.ts"),
    "export const answer = 1;",
  );
  return { root, repository, data };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for desktop fixture.");
}

test("desktop requires selected-folder trust and never exposes ignored or credential-bearing files", async () => {
  const f = await fixture(),
    events: DesktopEvent[] = [];
  const service = new LocalAgentService({
    dataDirectory: f.data,
    emit: (event) => events.push(event),
    openExternal: async () => {},
  });
  try {
    await writeFile(path.join(f.repository, ".env"), "SECRET=not-for-context");
    await writeFile(
      path.join(f.repository, "credential.ts"),
      'export const key = "sk-fake_credential_for_unit_fixture_12345";',
    );
    const selected = await service.selectWorkspace(f.repository);
    expect(selected.trusted).toBe(false);
    expect(selected.files).toEqual([]);
    await expect(service.readFile("answer.ts")).rejects.toThrow("Trust");
    await expect(
      service.trustWorkspace({
        root: path.dirname(selected.root),
        consent: true,
      }),
    ).rejects.toThrow("native picker");
    const trusted = await service.trustWorkspace({
      root: selected.root,
      consent: true,
    });
    expect(trusted.files.map((file) => file.path)).not.toContain(".env");
    await expect(service.readFile(".env")).rejects.toThrow("ignored");
    await expect(
      service.readFile("../desktop-state/desktop.json"),
    ).rejects.toThrow("inside");
    const secret = await service.readFile("credential.ts");
    expect(secret.readOnly).toBe(true);
    expect(secret.content).not.toContain("sk-fake");
    await expect(
      service.saveFile({
        path: secret.path,
        content: secret.content,
        expectedHash: secret.hash,
      }),
    ).rejects.toThrow("read-only");
    expect(events.filter((event) => event.type === "approval")).toHaveLength(0);
    const config = await stat(path.join(f.data, "desktop.json"));
    if (process.platform !== "win32") expect(config.mode & 0o777).toBe(0o600);
  } finally {
    await service.dispose();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("desktop file saves validate hashes, serialize actions, and honor explicit approval", async () => {
  const f = await fixture();
  const events: DesktopEvent[] = [];
  const service = new LocalAgentService({
    dataDirectory: f.data,
    emit: (event) => events.push(event),
    openExternal: async () => {},
  });
  try {
    const selected = await service.selectWorkspace(f.repository);
    await service.trustWorkspace({ root: selected.root, consent: true });
    const original = await service.readFile("answer.ts");
    const denied = service.saveFile({
      path: "answer.ts",
      content: "declined edit",
      expectedHash: original.hash,
    });
    await until(() => events.some((event) => event.type === "approval"));
    const approval = events.find((event) => event.type === "approval")!;
    if (approval.type !== "approval") throw Error();
    await expect(
      service.saveFile({
        path: "answer.ts",
        content: "parallel edit",
        expectedHash: original.hash,
      }),
    ).rejects.toThrow("active action");
    await service.respondApproval({
      id: approval.id,
      approved: false,
      scope: "once",
    });
    await expect(denied).rejects.toThrow("declined");
    expect(await readFile(path.join(f.repository, "answer.ts"), "utf8")).toBe(
      original.content,
    );
    await expect(
      service.saveFile({
        path: "answer.ts",
        content: "stale edit",
        expectedHash: "0".repeat(64),
      }),
    ).rejects.toThrow("changed");
    events.length = 0;
    const approved = service.saveFile({
      path: "answer.ts",
      content: "export const answer = 2;",
      expectedHash: original.hash,
    });
    await until(() => events.some((event) => event.type === "approval"));
    const second = events.find((event) => event.type === "approval")!;
    if (second.type !== "approval") throw Error();
    await service.respondApproval({
      id: second.id,
      approved: true,
      scope: "session",
    });
    const updated = await approved;
    expect(updated.content).toContain("= 2");
    const count = events.filter((event) => event.type === "approval").length;
    await service.saveFile({
      path: "answer.ts",
      content: "export const answer = 3;",
      expectedHash: updated.hash,
    });
    expect(events.filter((event) => event.type === "approval")).toHaveLength(
      count,
    );
    const command = service.runCommand({
      command: "echo command-must-not-run",
    });
    await until(() =>
      events.some(
        (event) => event.type === "approval" && event.kind === "shell",
      ),
    );
    const shell = events.find(
      (event) => event.type === "approval" && event.kind === "shell",
    )!;
    if (shell.type !== "approval") throw Error();
    await service.respondApproval({
      id: shell.id,
      approved: false,
      scope: "once",
    });
    expect((await command).exitCode).toBeNull();
  } finally {
    await service.dispose();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("desktop device login and real hosted tool loop keep tokens out of renderer and model context", async () => {
  const f = await fixture(),
    events: DesktopEvent[] = [],
    opened: string[] = [];
  const token = "D".repeat(43);
  let calls = 0,
    base = "";
  const prompts: string[] = [];
  const usage = {
    inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/device/start"))
        return Response.json({
          deviceCode: "C".repeat(43),
          userCode: "ABCD-EFGH",
          verificationUri: base + "/device?code=ABCD-EFGH",
          expiresIn: 600,
          interval: 5,
        });
      if (url.pathname.endsWith("/device/poll"))
        return Response.json({ status: "approved", token });
      if (url.pathname.endsWith("/models"))
        return Response.json({
          hostedEnabled: true,
          models: [{ id: "fixture/model" }],
        });
      if (url.pathname.endsWith("/devices/logout"))
        return Response.json({ ok: true });
      if (url.pathname.endsWith("/usage"))
        return Response.json({ freeRemainingMicros: 100000 });
      if (url.pathname.endsWith("/inference")) {
        expect(request.headers.get("authorization")).toBe("Bearer " + token);
        const body = (await request.json()) as { options: { prompt: unknown } };
        prompts.push(JSON.stringify(body.options.prompt));
        const first = calls++ === 0;
        const parts = first
          ? [
              {
                type: "tool-call",
                toolCallId: "read-notes",
                toolName: "read_file",
                input: JSON.stringify({ path: "notes.txt" }),
              },
            ]
          : [
              { type: "text-start", id: "answer" },
              {
                type: "text-delta",
                id: "answer",
                delta: "The notes were read safely.",
              },
              { type: "text-end", id: "answer" },
            ];
        return new Response(
          [
            ...parts,
            {
              type: "finish",
              finishReason: {
                unified: first ? "tool-calls" : "stop",
                raw: first ? "tool_calls" : "stop",
              },
              usage,
            },
          ]
            .map((part) => JSON.stringify(part) + "\n")
            .join(""),
          { headers: { "Content-Type": "application/x-ndjson" } },
        );
      }
      return Response.json(
        { error: "Unknown fixture endpoint" },
        { status: 404 },
      );
    },
  });
  base = `http://127.0.0.1:${server.port}`;
  const service = new LocalAgentService({
    dataDirectory: f.data,
    serverUrl: base,
    emit: (event) => events.push(event),
    openExternal: async (url) => {
      opened.push(url);
    },
    wait: async () => {},
  });
  try {
    await writeFile(
      path.join(f.repository, "notes.txt"),
      "Known desktop bearer credential: " + token,
    );
    const selected = await service.selectWorkspace(f.repository);
    await service.trustWorkspace({ root: selected.root, consent: true });
    const login = await service.login();
    expect(login.userCode).toBe("ABCD-EFGH");
    expect(opened).toEqual([login.verificationUri]);
    await until(() =>
      events.some((event) => event.type === "auth" && event.signedIn),
    );
    expect(JSON.stringify(await service.getState())).not.toContain(token);
    const run = await service.runAgent({
      prompt: "Inspect the notes file.",
      mode: "plan",
    });
    await until(
      () =>
        events.some(
          (event) => event.type === "done" && event.runId === run.runId,
        ) || events.some((event) => event.type === "error"),
    );
    expect(events.filter((event) => event.type === "error")).toHaveLength(0);
    expect(calls).toBe(2);
    expect(prompts[1]).not.toContain(token);
    expect(prompts[1]).toContain("redacted credential");
    expect(
      events.some(
        (event) => event.type === "tool-result" && event.name === "read_file",
      ),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain(token);
    expect(
      (await service.getState()).conversation?.some(
        (message) =>
          message.role === "assistant" && message.text.includes("read safely"),
      ),
    ).toBe(true);
    await service.dispose();
    const restored = new LocalAgentService({
      dataDirectory: f.data,
      serverUrl: base,
      emit: () => {},
      openExternal: async () => {},
    });
    try {
      await restored.selectWorkspace(f.repository);
      const state = await restored.getState();
      expect(state.auth.signedIn).toBe(true);
      expect(
        state.conversation?.some((message) =>
          message.text.includes("read safely"),
        ),
      ).toBe(true);
      await restored.logout();
      expect((await restored.getState()).auth.signedIn).toBe(false);
    } finally {
      await restored.dispose();
    }
  } finally {
    await service.dispose();
    await server.stop(true);
    await rm(f.root, { recursive: true, force: true });
  }
}, 15000);

test("desktop rejects device verification URLs outside the configured server", async () => {
  const f = await fixture();
  let opened = false;
  const service = new LocalAgentService({
    dataDirectory: f.data,
    emit: () => {},
    openExternal: async () => {
      opened = true;
    },
    fetch: async () =>
      Response.json({
        deviceCode: "C".repeat(43),
        userCode: "ABCD-EFGH",
        verificationUri: "https://attacker.invalid/device?code=ABCD-EFGH",
        expiresIn: 600,
        interval: 5,
      }),
  });
  try {
    await expect(service.login()).rejects.toThrow("untrusted verification");
    expect(opened).toBe(false);
  } finally {
    await service.dispose();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("desktop cancellation waits for an approved manual command to exit", async () => {
  const f = await fixture();
  const events: DesktopEvent[] = [];
  const service = new LocalAgentService({
    dataDirectory: f.data,
    emit: (event) => events.push(event),
    openExternal: async () => {},
  });
  try {
    const selected = await service.selectWorkspace(f.repository);
    await service.trustWorkspace({ root: selected.root, consent: true });
    // Bun itself is the portable executable in every CI job. The process ignores
    // TERM on POSIX so cancellation must await the process-tree hard kill.
    const script =
      "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync('child.pid',String(process.pid));console.log('READY:'+process.pid);setInterval(()=>{},1000)";
    const command = `"${process.execPath}" -e "${script}"`;
    const running = service.runCommand({ command });
    await until(() => events.some((event) => event.type === "approval"));
    await expect(service.createThread()).rejects.toThrow("current action");
    const approval = events.find((event) => event.type === "approval")!;
    if (approval.type !== "approval") throw new Error("Missing approval");
    await service.respondApproval({
      id: approval.id,
      approved: true,
      scope: "once",
    });
    // Wait for actual readiness rather than depending on host startup speed.
    let readyPid = 0;
    for (let i = 0; i < 500; i++) {
      try {
        readyPid = Number(
          await readFile(path.join(f.repository, "child.pid"), "utf8"),
        );
      } catch {}
      if (readyPid > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(readyPid).toBeGreaterThan(0);
    await service.cancelRun();
    const result = await running;
    const pid = Number(result.output.match(/READY:(\d+)/)?.[1]);
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow();
    expect((await service.getState()).running).toBe(false);
  } finally {
    await service.dispose();
    await rm(f.root, { recursive: true, force: true });
  }
}, 10000);

test("desktop threads migrate legacy history, persist selection and isolate trusted repositories", async () => {
  const f = await fixture();
  const { createHash } = await import("node:crypto");
  const canonical = await realpath(f.repository),
    filename = path.join(
      f.data,
      "sessions",
      createHash("sha256").update(canonical).digest("hex") + ".json",
    );
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(
    filename,
    JSON.stringify({
      root: canonical,
      messages: [
        { role: "user", content: "Existing local task" },
        { role: "assistant", content: "Preserved answer" },
      ],
    }),
    { mode: 0o600 },
  );
  const options = {
    dataDirectory: f.data,
    emit: () => {},
    openExternal: async () => {},
  };
  let service = new LocalAgentService(options);
  try {
    await service.selectWorkspace(f.repository);
    await expect(service.createThread()).rejects.toThrow("Trust");
    await service.trustWorkspace({ root: canonical, consent: true });
    const previous = await service.getState(),
      oldId = previous.activeThreadId!;
    expect(previous.conversation?.[1]?.text).toBe("Preserved answer");
    const fresh = await service.createThread();
    expect(fresh.threads).toHaveLength(2);
    expect(fresh.activeThreadId).not.toBe(oldId);
    expect(fresh.conversation).toEqual([]);
    const freshId = fresh.activeThreadId!;
    await service.openThread(oldId);
    expect((await service.getState()).conversation?.[0]?.text).toBe(
      "Existing local task",
    );
    await service.dispose();
    service = new LocalAgentService(options);
    await service.selectWorkspace(f.repository);
    expect((await service.getState()).activeThreadId).toBe(oldId);
    expect((await service.getState()).threads).toHaveLength(2);
    await service.openThread(freshId);
    await service.clearHistory();
    await service.openThread(oldId);
    expect((await service.getState()).conversation).toHaveLength(2);
    await expect(service.openThread("../desktop.json")).rejects.toThrow(
      "Invalid",
    );
    const other = path.join(f.root, "other");
    await mkdir(other);
    await service.selectWorkspace(other);
    await service.trustWorkspace({
      root: await realpath(other),
      consent: true,
    });
    expect((await service.getState()).threads).toEqual([]);
    await expect(service.openThread(oldId)).rejects.toThrow(
      "selected repository",
    );
    const info = await stat(filename);
    if (process.platform !== "win32") expect(info.mode & 0o777).toBe(0o600);
  } finally {
    await service.dispose();
    await rm(f.root, { recursive: true, force: true });
  }
});
