"use client";
import { useEffect, useRef, useState } from "react";
import { createVoiceController, type VoiceState } from "../../../packages/contracts/src/voice-browser";
import styles from "./voice-controls.module.css";

export function VoiceControls({ scopeKey, disabled = false, visible = true, onDictation, onTurn, cancelTurn }: {
  scopeKey: string; disabled?: boolean; visible?: boolean; onDictation(text: string): void;
  onTurn?: (text: string, signal: AbortSignal) => Promise<string>; cancelTurn?(): void;
}) {
  const callbacks = useRef({ onDictation, onTurn, cancelTurn });
  callbacks.current = { onDictation, onTurn, cancelTurn };
  const controller = useRef<ReturnType<typeof createVoiceController> | null>(null);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [active, setActive] = useState(false);
  const [capabilities, setCapabilities] = useState({ recognition: false, synthesis: false });
  const phase = useRef<VoiceState["phase"]>("idle");
  useEffect(() => {
    const instance = createVoiceController({
      onState(value) { phase.current = value.phase; setVoice(value); if (value.phase === "error" || value.phase === "unsupported") setActive(false); },
      onDictation: text => callbacks.current.onDictation(text),
      onTurn: (text, signal) => callbacks.current.onTurn?.(text, signal) ?? Promise.reject(Error("Use general chat for live voice conversations. Workspace dictation remains editable.")),
      cancelTurn: () => callbacks.current.cancelTurn?.(),
    });
    controller.current = instance;
    setCapabilities(instance.capabilities);
    return () => { instance.dispose(); controller.current = null; };
  }, []);
  useEffect(() => { if (!visible) { controller.current?.stop(); setActive(false); } }, [visible]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) { controller.current?.stop(); setActive(false); } };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  const previousScope = useRef(scopeKey);
  useEffect(() => {
    if (previousScope.current !== scopeKey) {
      const previous = previousScope.current;
      previousScope.current = scopeKey;
      // Only the first normal turn may replace a new-chat identity while thinking.
      const createsChat = previous.endsWith(":new") && previous.slice(0, previous.lastIndexOf(":")) === scopeKey.slice(0, scopeKey.lastIndexOf(":"));
      if (phase.current !== "thinking" || !createsChat) { controller.current?.stop(); setActive(false); }
    }
  }, [scopeKey]);
  const start = (mode: "dictation" | "conversation") => { setActive(true); controller.current?.start(mode); };
  return <div className={styles.voice}>
    <div className={styles.actions} role="group" aria-label="Voice input">
      {!active ? <><button type="button" disabled={disabled || !capabilities.recognition} onClick={() => start("dictation")}>Dictate</button>{onTurn ? <button type="button" disabled={disabled || !capabilities.recognition || !capabilities.synthesis} onClick={() => start("conversation")}>Live voice</button> : null}</> : <>
        <button type="button" onClick={() => { controller.current?.stop(); setActive(false); }}>Stop voice</button>
        <button type="button" aria-pressed={voice?.muted || false} onClick={() => controller.current?.mute(!voice?.muted)}>{voice?.muted ? "Unmute mic" : "Mute mic"}</button>
        {voice?.phase === "speaking" || voice?.phase === "thinking" ? <button type="button" onClick={() => controller.current?.interrupt()}>Interrupt</button> : null}
      </>}
    </div>
    {active || voice?.error || voice?.phase === "unsupported" ? <p className={styles.status} role="status" aria-live="polite">{voice?.error || (active ? `${voice?.phase || "idle"}${voice?.muted ? " · microphone muted" : ""}${voice?.transcript ? ` · ${voice.transcript}` : ""}` : "Speech recognition is unavailable in this browser.")}</p> : null}
    <p className={styles.status}>{active ? "Audio may be processed online by your browser’s speech provider." : onTurn ? "Dictation is editable; live voice sends each turn. Browser speech may process audio online." : "Dictation creates editable text. Your browser may process audio online."}</p>
    <details><summary>Voice privacy</summary><p>Your browser’s speech provider may process microphone audio online. Browser speech output may also use an online voice. Freecoda receives the transcript, not a stored audio recording. Live voice sends transcripts through your normal account, model and allowance. Dictation never sends a message automatically. Start only when you are ready; Stop ends this session.</p></details>
  </div>;
}
