import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { AccountThreadSync } from "../packages/cli/src/cloud-threads";
import {
  newConversation,
  saveConversation,
  loadConversation,
  conversationScope,
} from "../packages/cli/src/threads";

test("CLI account history migrates, resumes on another client, retries offline, forks conflicts and respects deletions/account boundaries", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "freecoda-cloud-threads-"));
  const prior = process.env.FREECODA_CONFIG_DIR;
  const records = new Map<string, any>();
  const tombstones = new Set<string>();
  let offline = false;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      if (offline) return Response.json({ error: "offline" }, { status: 503 });
      const userId =
        req.headers.get("authorization") === "Bearer alice" ? "alice" : "bob";
      const url = new URL(req.url);
      const id = url.pathname.split("/")[4];
      const key = `${userId}:${id}`;
      if (!id)
        return Response.json({
          userId,
          conversations: [...records.entries()]
            .filter(([k]) => k.startsWith(userId + ":"))
            .map(([, r]) => {
              const { messages, ...summary } = r;
              return summary;
            }),
          nextCursor: null,
          hasMore: false,
        });
      if (req.method === "DELETE") {
        records.delete(key);
        tombstones.add(key);
        return Response.json({ ok: true });
      }
      if (req.method === "GET")
        return records.has(key)
          ? Response.json({ conversation: records.get(key) })
          : Response.json({ error: "missing" }, { status: 404 });
      const body = (await req.json()) as any;
      if (tombstones.has(key))
        return Response.json({ error: "deleted" }, { status: 410 });
      const existing = records.get(key);
      if (body.expectedVersion !== (existing?.version ?? null))
        return Response.json({ error: "conflict" }, { status: 409 });
      const record = {
        id,
        title: body.title,
        mode: body.mode,
        messages: body.messages,
        version: (existing?.version || 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      records.set(key, record);
      return Response.json({ conversation: record });
    },
  });
  const config = { server: `http://127.0.0.1:${server.port}`, token: "alice" };
  try {
    process.env.FREECODA_CONFIG_DIR = path.join(base, "a");
    const legacy = await saveConversation({
      ...newConversation(conversationScope("/old-project", "chat")),
      messages: [
        { role: "user", content: "Legacy chat" },
        { role: "assistant", content: "Retained answer" },
      ],
    });
    const a = (await AccountThreadSync.open(config))!;
    expect(records.get(`alice:${legacy.id}`).messages).toHaveLength(2);
    const scope = a.scope("/new-project", "build");
    const privateDraft = await a.save(
      {
        ...newConversation(scope),
        messages: [
          { role: "user", content: "api_key=abcdefghijk and Bearer alice" },
        ],
      },
      "build",
    );
    expect(
      JSON.stringify(records.get(`alice:${privateDraft.id}`).messages),
    ).not.toContain("abcdefghijk");
    expect(
      JSON.stringify(records.get(`alice:${privateDraft.id}`).messages),
    ).not.toContain("Bearer alice");
    const initial = await a.save(
      {
        ...newConversation(scope),
        messages: [
          { role: "user", content: "Explain tools" },
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "x",
                toolName: "read_file",
                input: { path: "example.ts" },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "x",
                toolName: "read_file",
                output: { type: "json", value: { content: "hello" } },
              },
            ],
          },
        ],
      },
      "build",
    );
    expect(a.hasPending()).toBe(false);
    offline = true;
    const queued = await a.save(
      {
        ...initial,
        messages: [
          ...initial.messages,
          { role: "user", content: "Offline question" },
        ],
      },
      "build",
    );
    expect(a.hasPending()).toBe(true);
    expect(records.get(`alice:${initial.id}`).messages).toHaveLength(3);
    offline = false;
    await a.flush();
    expect(a.hasPending()).toBe(false);
    process.env.FREECODA_CONFIG_DIR = path.join(base, "b");
    const b = (await AccountThreadSync.open(config))!;
    expect(
      (await b.list("/other-trusted-folder", "build")).map((c) => c.id),
    ).toContain(initial.id);
    expect(
      (await b.list("/other-trusted-folder", "chat")).map((c) => c.id),
    ).not.toContain(initial.id);
    const resumed = await b.load("/other-trusted-folder", "build", initial.id);
    expect(resumed.messages[1]).toEqual(initial.messages[1]);
    await b.save(
      {
        ...resumed,
        messages: [
          ...resumed.messages,
          { role: "assistant", content: "Saved on device B" },
        ],
      },
      "build",
    );
    process.env.FREECODA_CONFIG_DIR = path.join(base, "a");
    const fork = await a.save(
      {
        ...queued,
        messages: [
          ...queued.messages,
          { role: "user", content: "Concurrent device A" },
        ],
      },
      "build",
    );
    expect(fork.id).not.toBe(initial.id);
    await a.flush();
    expect(records.get(`alice:${initial.id}`).messages.at(-1).content).toBe(
      "Saved on device B",
    );
    expect(records.has(`alice:${fork.id}`)).toBe(true);
    process.env.FREECODA_CONFIG_DIR = path.join(base, "b");
    await b.clear("/other-trusted-folder", "build");
    process.env.FREECODA_CONFIG_DIR = path.join(base, "a");
    await a.save(
      {
        ...initial,
        messages: [
          ...initial.messages,
          { role: "user", content: "Stale deleted copy" },
        ],
      },
      "build",
    );
    expect(records.has(`alice:${initial.id}`)).toBe(false);
    const unverifiedScope = (token: string) =>
      `unverified-account:${createHash("sha256")
        .update(config.server + token)
        .digest("hex")}:chat:/offline-project`;
    const bobOffline = await saveConversation({
      ...newConversation(unverifiedScope("bob")),
      messages: [{ role: "user", content: "Bob offline history" }],
    });
    const aliceOffline = await saveConversation({
      ...newConversation(unverifiedScope("alice")),
      messages: [{ role: "user", content: "Alice offline history" }],
    });
    const bob = (await AccountThreadSync.open({ ...config, token: "bob" }))!;
    const bobHistory = await bob.list("/old-project", "chat");
    expect(bobHistory.map((c) => c.id)).toEqual([bobOffline.id]);
    expect(records.has(`bob:${aliceOffline.id}`)).toBe(false);
    expect(records.get(`bob:${bobOffline.id}`).mode).toBe("chat");
    expect(bob.scope("/new-project", "build")).not.toBe(scope);
  } finally {
    if (prior === undefined) delete process.env.FREECODA_CONFIG_DIR;
    else process.env.FREECODA_CONFIG_DIR = prior;
    await server.stop(true);
    await rm(base, { recursive: true, force: true });
  }
});
