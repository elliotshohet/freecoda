import { expect, test } from "bun:test";
import { createVoiceController, type VoiceState } from "../packages/contracts/src/voice-browser";

test("browser voice starts only explicitly, keeps dictation editable and pauses mic around live turns", async () => {
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  const microphones: FakeRecognition[] = [], spoken: { text: string; onend?: () => void }[] = [];
  class FakeRecognition {
    continuous = false; interimResults = false; lang = ""; started = 0; aborted = false;
    onstart?: () => void; onend?: () => void; onerror?: (event: { error: string }) => void; onresult?: (event: unknown) => void;
    constructor() { microphones.push(this); }
    start() { this.started++; this.onstart?.(); }
    abort() { this.aborted = true; this.onend?.(); }
    result(text: string) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }); }
  }
  class Utterance { onend?: () => void; constructor(readonly text: string) {} }
  Object.assign(globalThis, { SpeechRecognition: FakeRecognition, SpeechSynthesisUtterance: Utterance, speechSynthesis: { cancel() {}, speak(value: Utterance) { spoken.push(value); } } });
  const states: VoiceState[] = [], dictated: string[] = [], turns: string[] = [];
  let complete!: (reply: string) => void;
  let signal: AbortSignal | undefined;
  const engine = createVoiceController({ onState: state => states.push(state), onDictation: text => dictated.push(text), onTurn(text, abort) { turns.push(text); signal = abort; return new Promise(resolve => { complete = resolve; }); } });
  try {
    expect(microphones).toHaveLength(0);
    expect(engine.capabilities).toEqual({ recognition: true, synthesis: true });
    engine.start("dictation");
    microphones.at(-1)!.result(" editable words");
    expect(dictated).toEqual([" editable words"]);
    expect(turns).toEqual([]);
    engine.stop();
    expect(microphones.at(-1)!.aborted).toBe(true);
    engine.start("conversation");
    microphones.at(-1)!.result("Explain the change");
    expect(turns).toEqual(["Explain the change"]);
    expect(microphones.at(-1)!.aborted).toBe(true);
    expect(states.at(-1)?.phase).toBe("thinking");
    complete("Here is the explanation.");
    await Promise.resolve(); await Promise.resolve();
    expect(spoken[0].text).toBe("Here is the explanation.");
    expect(states.at(-1)?.phase).toBe("speaking");
    const count = microphones.length;
    spoken[0].onend?.();
    expect(microphones.length).toBe(count + 1);
    engine.mute(true);
    expect(microphones.at(-1)!.aborted).toBe(true);
    engine.mute(false);
    microphones.at(-1)!.result("Another turn");
    engine.stop();
    expect(signal?.aborted).toBe(true);
    complete("Late reply must not speak");
    await Promise.resolve(); await Promise.resolve();
    expect(spoken).toHaveLength(1);
    engine.start("conversation");
    microphones.at(-1)!.result("/shell dangerous");
    expect(states.at(-1)?.phase).toBe("error");
    expect(turns).toHaveLength(2);
  } finally {
    engine.dispose();
    for (const key of ["SpeechRecognition", "SpeechSynthesisUtterance", "speechSynthesis"]) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("browser voice reports unsupported without starting or pretending to transcribe and serializes standalone", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "SpeechRecognition");
  const prefixed = Object.getOwnPropertyDescriptor(globalThis, "webkitSpeechRecognition");
  Reflect.deleteProperty(globalThis, "SpeechRecognition"); Reflect.deleteProperty(globalThis, "webkitSpeechRecognition");
  try {
    const states: VoiceState[] = [];
    const standalone = new Function(`return (${createVoiceController.toString()})`)() as typeof createVoiceController;
    const engine = standalone({ onState: value => states.push(value), onDictation() { throw Error("not called"); }, async onTurn() { throw Error("not called"); } });
    expect(engine.capabilities.recognition).toBe(false);
    engine.start("dictation");
    expect(states.at(-1)?.phase).toBe("unsupported");
    engine.dispose();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "SpeechRecognition", descriptor);
    if (prefixed) Object.defineProperty(globalThis, "webkitSpeechRecognition", prefixed);
  }
});
