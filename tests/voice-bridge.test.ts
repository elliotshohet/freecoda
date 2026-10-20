import { test, expect } from "bun:test";
import { startVoiceBridge } from "../packages/core/src/voice-bridge";

test("voice companion binds only loopback, requires bearer and same origin, and serves a self-contained CSP-protected explicit-start page", async () => {
  const transcripts: unknown[] = [], controls: string[] = [];
  const bridge = await startVoiceBridge({ onTranscript(input) { transcripts.push(input); }, onControl(action) { controls.push(action); } });
  const url = new URL(bridge.url), token = url.hash.slice(1); url.hash = "";
  const headers = { Authorization: `Bearer ${token}`, Origin: url.origin, "Content-Type": "application/json" };
  try {
    expect(url.hostname).toBe("127.0.0.1");
    const page = await fetch(url); const html = await page.text();
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(html).toContain("Start dictation");
    expect(html).toContain("Your browser’s speech service may process audio online");
    expect(html).not.toContain(token);
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1); expect(() => new Function(scripts[0]![1]!)).not.toThrow();
    expect((await fetch(new URL("/events", url))).status).toBe(401);
    // Same JS character length but different UTF-8 byte length must reject, not throw.
    expect((await fetch(new URL("/events", url), { headers: { Authorization: `Bearer ${"é".repeat(64)}` } })).status).toBe(401);
    expect((await fetch(new URL("/transcript", url), { method: "POST", headers: { ...headers, Origin: "https://attacker.example" }, body: JSON.stringify({ text: "wrong", mode: "conversation" }) })).status).toBe(403);
    expect((await fetch(new URL("/transcript", url), { method: "POST", headers, body: JSON.stringify({ text: "  editable words  ", mode: "dictation" }) })).status).toBe(200);
    expect(transcripts).toEqual([{ text: "  editable words  ", mode: "dictation" }]);
    expect((await fetch(new URL("/transcript", url), { method: "POST", headers, body: JSON.stringify({ text: "x".repeat(20001), mode: "conversation" }) })).status).toBe(400);
    expect((await fetch(new URL("/control", url), { method: "POST", headers, body: JSON.stringify({ action: "interrupt" }) })).status).toBe(200);
    expect(controls).toEqual(["interrupt"]);
    const events = fetch(new URL("/events", url), { headers });
    bridge.publish({ type: "assistant", text: "Spoken reply" });
    expect(await (await events).json()).toEqual([{ type: "assistant", text: "Spoken reply" }]);
  } finally { await bridge.close(); }
  await expect(fetch(url)).rejects.toThrow();
});

test("voice bridge bounds the event queue and rejects requests with unexpected host", async () => {
  const bridge = await startVoiceBridge({ onTranscript() {} });
  const url = new URL(bridge.url), token = url.hash.slice(1); url.hash = "";
  try {
    expect((await fetch(url, { headers: { Host: "attacker.example" } })).status).toBe(403);
    for (let i = 0; i < 50; i++) bridge.publish({ type: "status", text: String(i) });
    const events = await (await fetch(new URL("/events", url), { headers: { Authorization: `Bearer ${token}` } })).json() as unknown[];
    expect(events).toHaveLength(32);
    expect(events[0]).toEqual({ type: "status", text: "18" });
  } finally { await bridge.close(); }
});


test("voice conversation requires a turn identity, carries it to replies, and authenticated page closure ends its own bridge", async () => {
  let captured: unknown, stopped = 0, closed = 0;
  const bridge = await startVoiceBridge({ onTranscript(input) { captured = input; }, onControl(action) { if (action === "stop") stopped++; }, onClose() { closed++; } });
  const url = new URL(bridge.url), token = url.hash.slice(1); url.hash = "";
  const headers = { Authorization: `Bearer ${token}`, Origin: url.origin, "Content-Type": "application/json" };
  const turnId = crypto.randomUUID();
  try {
    const cancelledId = crypto.randomUUID();
    await fetch(new URL("/control", url), { method: "POST", headers, body: JSON.stringify({ action: "interrupt", turnId: cancelledId }) });
    expect((await fetch(new URL("/transcript", url), { method: "POST", headers, body: JSON.stringify({ mode: "conversation", text: "Late cancelled speech", turnId: cancelledId }) })).status).toBe(409);
    expect(captured).toBeUndefined();
    expect((await fetch(new URL("/transcript", url), { method: "POST", headers, body: JSON.stringify({ mode: "conversation", text: "Hello" }) })).status).toBe(400);
    expect((await fetch(new URL("/transcript", url), { method: "POST", headers, body: JSON.stringify({ mode: "conversation", text: "Hello", turnId }) })).status).toBe(200);
    expect(captured).toEqual({ mode: "conversation", text: "Hello", turnId });
    bridge.publish({ type: "assistant", text: "Reply", turnId });
    expect(await (await fetch(new URL("/events", url), { headers })).json()).toEqual([{ type: "assistant", text: "Reply", turnId }]);
    expect((await fetch(new URL("/control", url), { method: "POST", headers, body: JSON.stringify({ action: "stop", close: true }) })).status).toBe(200);
  } finally { await bridge.close(); }
  // close is idempotent and the lifecycle callback cannot leave stale CLI/Desktop state.
  expect(closed).toBe(1);
  expect(stopped).toBeGreaterThan(0);
});
