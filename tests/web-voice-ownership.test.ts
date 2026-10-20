import { expect, test } from "bun:test";
import { runOwnedVoiceTurn } from "../apps/web/lib/owned-voice-turn";

test("rejected busy voice turns cannot cancel an unrelated typed request", async () => {
  const voice = new AbortController(), typed = new AbortController();
  const rejected = runOwnedVoiceTurn(voice.signal, async () => false);
  await expect(rejected).rejects.toThrow("could not complete");
  voice.abort();
  expect(typed.signal.aborted).toBe(false);
});

test("voice interruption aborts only the controller captured by its own accepted send", async () => {
  const voice = new AbortController(), owned = new AbortController(), typed = new AbortController();
  let complete!: (accepted: boolean) => void;
  const pending = runOwnedVoiceTurn(voice.signal, observer => {
    observer.onController(owned);
    return new Promise(resolve => { complete = resolve; });
  });
  voice.abort();
  expect(owned.signal.aborted).toBe(true);
  expect(typed.signal.aborted).toBe(false);
  complete(false);
  await expect(pending).rejects.toThrow("stopped");
});

test("completed voice turns retain their own reply and stop owning cancellation before queued typed work", async () => {
  const voice = new AbortController(), owned = new AbortController(), queuedTyped = new AbortController();
  const answer = await runOwnedVoiceTurn(voice.signal, async observer => {
    observer.onController(owned);
    observer.onReply("Completed spoken reply");
    return true;
  });
  expect(answer).toBe("Completed spoken reply");
  voice.abort();
  expect(owned.signal.aborted).toBe(false);
  expect(queuedTyped.signal.aborted).toBe(false);
});

test("cancellation before controller assignment aborts that late controller without touching typed work", async () => {
  const voice = new AbortController(), late = new AbortController(), typed = new AbortController();
  const pending = runOwnedVoiceTurn(voice.signal, async observer => {
    voice.abort();
    observer.onController(late);
    return false;
  });
  await expect(pending).rejects.toThrow("stopped");
  expect(late.signal.aborted).toBe(true);
  expect(typed.signal.aborted).toBe(false);
});
