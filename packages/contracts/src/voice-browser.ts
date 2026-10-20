export type VoiceMode = "dictation" | "conversation";
export type VoiceState = { phase: "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "error" | "unsupported"; mode: VoiceMode; muted: boolean; transcript: string; error?: string };
export type VoiceOptions = { onState(state: VoiceState): void; onDictation(text: string): void; onTurn(text: string, signal: AbortSignal): Promise<string>; cancelTurn?(): void };
/** Self-contained for the native clients' browser companion. No microphone starts on construction. */
export function createVoiceController(options: VoiceOptions) {
  type Recognition = { continuous: boolean; interimResults: boolean; lang: string; start(): void; abort(): void; onstart: (() => void) | null; onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null; onresult: ((event: { resultIndex: number; results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } } }) => void) | null };
  const environment = globalThis as typeof globalThis & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const RecognitionClass = environment.SpeechRecognition || environment.webkitSpeechRecognition;
  const capabilities = { recognition: !!RecognitionClass, synthesis: typeof environment.speechSynthesis !== "undefined" && typeof environment.SpeechSynthesisUtterance !== "undefined" };
  let state: VoiceState = { phase: capabilities.recognition ? "idle" : "unsupported", mode: "dictation", muted: false, transcript: "" };
  let active = false, generation = 0, recognition: Recognition | undefined, turn: AbortController | undefined;
  let restart: ReturnType<typeof setTimeout> | undefined;
  const publish = (phase: VoiceState["phase"], transcript = "", error?: string) => { state = { ...state, phase, transcript, error }; options.onState({ ...state }); };
  const haltRecognition = () => { const previous = recognition; recognition = undefined; if (previous) { previous.onend = null; previous.onresult = null; previous.onerror = null; previous.onstart = null; try { previous.abort(); } catch {} } };
  const stop = () => { active = false; generation++; clearTimeout(restart); haltRecognition(); if (turn) { turn.abort(); turn = undefined; options.cancelTurn?.(); } if (capabilities.synthesis) environment.speechSynthesis.cancel(); publish(capabilities.recognition ? "idle" : "unsupported"); };
  const fail = (message: string) => { stop(); publish("error", "", message); };
  const listen = () => {
    if (!active || state.muted || !RecognitionClass) return;
    haltRecognition();
    const current = generation, mic = new RecognitionClass(); recognition = mic;
    mic.continuous = true; mic.interimResults = true; mic.lang = typeof navigator !== "undefined" ? navigator.language : "en-US";
    mic.onstart = () => { if (current === generation && recognition === mic) publish("listening"); };
    mic.onerror = event => {
      if (current !== generation || recognition !== mic || event.error === "aborted") return;
      if (event.error === "no-speech") return;
      fail(event.error === "not-allowed" || event.error === "service-not-allowed" ? "Microphone or browser speech permission was denied. Allow it in browser settings, then start again." : `Speech recognition failed (${event.error}). Check your microphone, network and browser speech support.`);
    };
    mic.onend = () => { if (active && current === generation && recognition === mic && !state.muted) restart = setTimeout(listen, 350); };
    mic.onresult = event => {
      if (!active || current !== generation || recognition !== mic || state.muted) return;
      let final = "", interim = "";
      for (let index = event.resultIndex; index < event.results.length; index++) { const result = event.results[index]; if (result.isFinal) final += result[0].transcript; else interim += result[0].transcript; }
      publish(interim ? "transcribing" : "listening", interim);
      if (!final.trim()) return;
      if (state.mode === "dictation") { options.onDictation(final); return; }
      // Spoken slash commands must never acquire command/tool privileges.
      if (final.trimStart().startsWith("/")) { fail("Voice conversation cannot run slash commands. Use dictation to review and edit this text first."); return; }
      haltRecognition();
      const controller = new AbortController(); turn = controller;
      publish("thinking", final);
      void options.onTurn(final.trim(), controller.signal).then(reply => {
        if (!active || current !== generation || controller.signal.aborted) return;
        turn = undefined;
        if (!reply.trim()) throw Error("No completed reply was returned. Review the conversation before continuing.");
        if (!capabilities.synthesis) { fail("Speech output is unavailable in this browser. The reply remains in your conversation."); return; }
        publish("speaking");
        const utterance = new environment.SpeechSynthesisUtterance(reply.slice(0, 16000));
        utterance.onend = () => { if (active && current === generation) { publish("idle"); listen(); } };
        utterance.onerror = () => { if (active && current === generation) fail("Speech output failed. The reply remains in your conversation."); };
        environment.speechSynthesis.speak(utterance);
      }).catch(error => { if (active && current === generation && !controller.signal.aborted) fail(error instanceof Error ? error.message : "Voice conversation failed."); });
    };
    try { publish("listening"); mic.start(); } catch { fail("Speech recognition could not start. Use a supported browser and allow microphone access."); }
  };
  options.onState({ ...state });
  return {
    capabilities,
    start(mode: VoiceMode) { stop(); state.mode = mode; state.muted = false; if (!RecognitionClass || (mode === "conversation" && !capabilities.synthesis)) { publish("unsupported", "", "This browser does not support the speech services required for this mode."); return; } active = true; listen(); },
    stop,
    mute(muted: boolean) { state.muted = muted; if (muted) { clearTimeout(restart); haltRecognition(); if (state.phase === "listening" || state.phase === "transcribing") publish("idle"); } else if (active && !turn && state.phase !== "speaking") listen(); options.onState({ ...state }); },
    interrupt() { if (!active) return; generation++; clearTimeout(restart); haltRecognition(); if (turn) { turn.abort(); turn = undefined; options.cancelTurn?.(); } if (capabilities.synthesis) environment.speechSynthesis.cancel(); publish("idle"); listen(); },
    dispose: stop,
  };
}
