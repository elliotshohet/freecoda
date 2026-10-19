"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import styles from "./conversation-commands.module.css";

import { filterConversationCommands } from "@freecoda/contracts";

export function useConversationCommands(value: string, choose: (command: string) => void) {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => { setSelected(0); setDismissed(null); }, [value]);
  const matches = value.startsWith("/") && !/\s/.test(value) && dismissed !== value
    ? filterConversationCommands(value, "web", 50) : [];
  const index = Math.min(selected, Math.max(0, matches.length - 1));
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!matches.length || event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") { event.preventDefault(); setDismissed(value); return true; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setSelected((index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length); return true;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      event.preventDefault(); choose(matches[index].name); setSelected(0); return true;
    }
    return false;
  }
  useEffect(() => { if (matches.length) document.getElementById(`${id}-${index}`)?.scrollIntoView({ block: "nearest" }); }, [id, index, value, matches.length]);
  const list = matches.length ? <section className={styles.palette} id={id} role="listbox" aria-label="Conversation commands">
    {matches.map(({ name, description }, item) => <button key={name} id={`${id}-${item}`} type="button" role="option" aria-selected={item === index} onMouseDown={event => event.preventDefault()} onClick={() => { choose(name); setSelected(0); }}><strong>{name}</strong><span>{description}</span></button>)}
  </section> : null;
  return { list, keyDown, attributes: { "aria-autocomplete": "list" as const, "aria-controls": matches.length ? id : undefined, "aria-expanded": matches.length > 0, "aria-activedescendant": matches.length ? `${id}-${index}` : undefined } };
}
