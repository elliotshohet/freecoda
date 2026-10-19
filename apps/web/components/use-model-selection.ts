"use client";

import { useCallback, useEffect, useState } from "react";

export type FreeModel = { id: string; name: string };
type Selection = { userId?: string; model: string };
type ModelEventDetail = { userId: string; model: string };
const eventName = "freecoda:model-selected";

function storageKey(userId: string) {
  return `freecoda:model:${encodeURIComponent(userId)}`;
}

export function useModelSelection(userId: string | undefined, models: FreeModel[]) {
  const [selection, setSelection] = useState<Selection>({ model: "" });
  const allowed = models.map((model) => model.id);
  const model = selection.userId === userId && allowed.includes(selection.model)
    ? selection.model
    : models[0]?.id || "";

  useEffect(() => {
    if (!userId) {
      setSelection({ model: "" });
      return;
    }
    setSelection((current) => {
      if (current.userId === userId && allowed.includes(current.model)) return current;
      let saved = "";
      try { saved = localStorage.getItem(storageKey(userId)) || ""; } catch { /* Storage can be disabled. */ }
      return { userId, model: allowed.includes(saved) ? saved : models[0]?.id || "" };
    });
  }, [userId, models]);

  useEffect(() => {
    function receive(event: Event) {
      const detail = (event as CustomEvent<ModelEventDetail>).detail;
      if (!detail || detail.userId !== userId || !allowed.includes(detail.model)) return;
      setSelection({ userId: detail.userId, model: detail.model });
    }
    function receiveStorage(event: StorageEvent) {
      if (!userId || event.key !== storageKey(userId) || !event.newValue || !allowed.includes(event.newValue)) return;
      setSelection({ userId, model: event.newValue });
    }
    window.addEventListener(eventName, receive);
    window.addEventListener("storage", receiveStorage);
    return () => {
      window.removeEventListener(eventName, receive);
      window.removeEventListener("storage", receiveStorage);
    };
  }, [userId, models]);

  const setModel = useCallback((next: string) => {
    if (!userId || !models.some((candidate) => candidate.id === next)) return false;
    setSelection({ userId, model: next });
    try { localStorage.setItem(storageKey(userId), next); } catch { /* The in-memory preference still works. */ }
    window.dispatchEvent(new CustomEvent<ModelEventDetail>(eventName, { detail: { userId, model: next } }));
    return true;
  }, [userId, models]);

  return { model, setModel };
}
