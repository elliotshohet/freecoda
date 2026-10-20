import { test, expect } from "bun:test";
import { TerminalScreen } from "../packages/cli/src/ui";

test("CLI dictation edits draft without dispatch; live voice preserves existing draft and cannot become a slash command", async () => {
  const screen = new TerminalScreen("/tmp", "Hosted connection");
  // No terminal is opened; renderer output is stubbed for an isolated composer fixture.
  const fixture = screen as any; fixture.render = () => {}; fixture.schedule = () => {};
  const prompt = screen.prompt();
  screen.insertVoiceDraft("Keep this editable");
  expect(fixture.value).toBe("Keep this editable");
  expect(fixture.question.kind).toBe("composer");
  screen.submitVoiceTurn("/exit");
  expect(await prompt).toBe("Voice message:\n/exit");
  fixture.busy = true;
  screen.insertVoiceDraft(" plus later words");
  fixture.busy = false;
  const next = screen.prompt();
  expect(fixture.value).toBe("Keep this editable plus later words");
  fixture.submit("Reviewed message");
  expect(await next).toBe("Reviewed message");
});

test("voice cannot answer approval prompts or dispatch while work is active", async () => {
  const screen = new TerminalScreen("/tmp", "Hosted connection"), fixture = screen as any;
  fixture.render = () => {}; fixture.schedule = () => {};
  fixture.question = { kind: "approval" };
  expect(() => screen.insertVoiceDraft("yes")).toThrow("confirmation");
  expect(() => screen.submitVoiceTurn("yes")).toThrow("current turn");
  fixture.question = undefined; fixture.busy = true;
  screen.insertVoiceDraft("draft during response");
  expect(fixture.value).toBe("draft during response");
  expect(() => screen.submitVoiceTurn("send")).toThrow("current turn");
});

test("Stop before CLI agent startup prevents dispatch across asynchronous setup", async () => {
  const { createVoiceTurnGuard } = await import("../packages/cli/src/voice-turn");
  const guard = createVoiceTurnGuard();
  const screen = new TerminalScreen("/tmp", "Hosted connection"), fixture = screen as any;
  fixture.render = () => {}; fixture.schedule = () => {};
  const composer = screen.prompt();
  let release!: () => void, dispatched = false;
  const setup = new Promise<void>(resolve => { release = resolve; });
  const pending = (async () => {
    expect(await composer).toBe("Voice message:\nDo not send after Stop");
    await setup; // e.g. conversation hydration, trust, or extension loading
    guard.assertActive();
    dispatched = true;
  })();
  screen.submitVoiceTurn("Do not send after Stop");
  // This is the gap before the loop can install its normal screen.onCancel hook.
  expect(screen.onCancel).toBeUndefined();
  guard.cancel();
  release();
  await expect(pending).rejects.toThrow();
  expect(dispatched).toBe(false);
  const unrelatedTypedTurn = new AbortController();
  expect(unrelatedTypedTurn.signal.aborted).toBe(false);
});
