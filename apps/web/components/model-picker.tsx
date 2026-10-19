"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Check, X } from "lucide-react";
import type { FreeModel } from "./use-model-selection";
import styles from "./model-picker.module.css";

export function modelDisplayName(model: FreeModel) {
  return model.name === model.id && /beam-free/i.test(model.id) ? "Beam Free" : model.name;
}

export function ModelPicker({ open, models, selected, onSelect, onClose }: {
  open: boolean;
  models: FreeModel[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    return () => previous?.focus();
  }, [open]);
  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "Tab") {
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled])") || []);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="model-picker-title" aria-describedby="model-picker-description" onKeyDown={handleKeyDown}>
      <header className={styles.header}>
        <div><p>Free models</p><h2 id="model-picker-title">Choose a model</h2></div>
        <button type="button" className={styles.close} aria-label="Close model picker" onClick={onClose}><X size={18} /></button>
      </header>
      <p id="model-picker-description" className={styles.description}>Your choice applies to new requests across Chat and Workspace. Active requests keep their selected model.</p>
      {models.length ? <div className={styles.options} role="radiogroup" aria-label="Available free models">
        {models.map((model) => <button key={model.id} type="button" role="radio" aria-checked={selected === model.id} className={styles.option} onClick={() => { onSelect(model.id); onClose(); }} onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const options = Array.from(dialog.current?.querySelectorAll<HTMLElement>('[role="radio"]') || []);
          const index = options.indexOf(event.currentTarget);
          options[(index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length]?.focus();
        }}>
          <span><strong>{modelDisplayName(model)}</strong><small>{model.id}</small></span>
          {selected === model.id && <Check size={17} aria-hidden="true" />}
        </button>)}
      </div> : <p className={styles.empty}>No approved free models are currently available.</p>}
      <footer className={styles.footer}>Only models approved as zero-cost are listed.</footer>
    </section>
  </div>;
}
