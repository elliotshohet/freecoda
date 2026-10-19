"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { validChats, type Conversation } from "./history";
import { cloudHistory, conversationRequest, cloudConversationBody, displayCloudConversation, ConversationHttpError, type CloudConversation } from "./cloud-history";
export function useCloudHistory(userId: string | undefined, busy: boolean) {
  const [chats, setChats] = useState<Conversation[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [loadedOwner, setLoadedOwner] = useState<string>();
  const [storageError, setStorageError] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [opening, setOpening] = useState(false);
  const [syncRevision, setSyncRevision] = useState(0);
  const current = useRef(chats); current.current = chats;
  const owner = useRef(userId); owner.current = userId;
  const activeSync = useRef(false);
  const removed = useRef(new Set<string>());
  const pendingDeletes = useRef(new Set<string>());
  const refreshGeneration = useRef(0);
  const key = userId ? `freecoda-chat-v1:${userId}` : null;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!userId || !key) return;
    const generation = ++refreshGeneration.current;
    try {
      for (const id of [...pendingDeletes.current]) {
        await conversationRequest(`/${id}`, "DELETE", undefined, signal);
        if (signal?.aborted || owner.current !== userId) return;
        pendingDeletes.current.delete(id);
        try { localStorage.setItem(`${key}:deleted`, JSON.stringify([...pendingDeletes.current])); } catch { setStorageError(true); }
      }
      const remote = await cloudHistory(userId, signal);
      if (signal?.aborted || owner.current !== userId || generation !== refreshGeneration.current) return;
      setChats(local => {
        const merged = remote.filter(chat => !removed.current.has(chat.id)).map(chat => local.find(item => item.id === chat.id && (item.cloudDirty || (item.cloudVersion === chat.cloudVersion && item.cloudLoaded !== false))) || chat);
        for (const chat of local) if (!removed.current.has(chat.id) && !remote.some(item => item.id === chat.id)) {
          if (chat.cloudVersion === undefined) merged.push(chat);
          else if (chat.cloudDirty) merged.push({ ...chat, cloudDeleted: true });
        }
        return merged.sort((a, b) => b.updatedAt - a.updatedAt);
      });
      setSyncError("");
    } catch (error) { if (!signal?.aborted && owner.current === userId) setSyncError(error instanceof Error ? error.message : "Cloud sync unavailable. Your offline copy is kept."); }
  }, [userId, key]);
  useEffect(() => {
    const controller = new AbortController();
    setHistoryReady(false); setLoadedOwner(undefined); setChats([]); setSyncError(""); setStorageError(false);
    refreshGeneration.current++;
    pendingDeletes.current = new Set(); removed.current = new Set();
    if (!key) { setHistoryReady(true); return; }
    try {
      const deletions = JSON.parse(localStorage.getItem(`${key}:deleted`) || "[]");
      pendingDeletes.current = new Set(Array.isArray(deletions) ? deletions.filter((id): id is string => typeof id === "string") : []);
      removed.current = new Set(pendingDeletes.current);
      setChats(validChats(JSON.parse(localStorage.getItem(key) || "[]")).filter(chat => !removed.current.has(chat.id)));
    } catch { setStorageError(true); }
    void refresh(controller.signal).finally(() => { if (!controller.signal.aborted) { setLoadedOwner(userId); setHistoryReady(true); } });
    return () => controller.abort();
  }, [key, refresh]);
  useEffect(() => {
    if (!key || !historyReady || loadedOwner !== userId) return;
    try { localStorage.setItem(key, JSON.stringify(chats)); } catch { setStorageError(true); }
  }, [key, chats, historyReady, loadedOwner, userId]);
  useEffect(() => {
    if (busy || !historyReady || !key || !userId || loadedOwner !== userId) return;
    const timer = setTimeout(async () => {
      if (activeSync.current) return;
      activeSync.current = true;
      let wrote = false;
      try {
        for (const chat of current.current.filter(chat => chat.mode !== "coding" && !chat.cloudDeleted && (chat.cloudDirty || chat.cloudVersion === undefined))) {
          if (owner.current !== userId || removed.current.has(chat.id)) continue;
          const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chat.id) ? chat.id : crypto.randomUUID();
          try {
            const { conversation } = await conversationRequest(`/${id}`, "PUT", cloudConversationBody(chat)) as { conversation: CloudConversation };
            wrote = true;
            if (owner.current !== userId) break;
            setChats(local => local.map(item => item.id !== chat.id ? item : { ...item, id, cloudVersion: conversation.version, cloudDirty: item.updatedAt !== chat.updatedAt }));
          } catch (error) {
            if (error instanceof ConversationHttpError && error.status === 409) {
              wrote = true;
              if (owner.current !== userId || removed.current.has(chat.id)) break;
              const copyId = crypto.randomUUID();
              setChats(local => local.map(item => item.id === chat.id ? { ...item, id: copyId, title: `${item.title.slice(0, 140)} (conflict copy)`, cloudVersion: undefined, cloudDirty: true } : item));
              setSyncError("Another device changed this conversation. Your changes were preserved as a separate copy.");
            } else if (error instanceof ConversationHttpError && error.status === 410) {
              if (owner.current !== userId) break;
              setChats(local => local.map(item => item.id === chat.id ? { ...item, cloudDeleted: true } : item));
              setSyncError("This conversation was deleted on another device. Unsynced content remains in your offline copy.");
            } else throw error;
          }
        }
      } catch (error) { if (owner.current === userId) setSyncError(error instanceof Error ? error.message : "Cloud sync failed. Your offline copy is kept."); }
      finally { activeSync.current = false; if (wrote || owner.current !== userId) setSyncRevision(value => value + 1); }
    }, 700);
    return () => { clearTimeout(timer); };
  }, [chats, busy, historyReady, key, userId, loadedOwner, syncRevision]);
  useEffect(() => {
    const focus = () => { if (!busy && !activeSync.current) void refresh(); };
    window.addEventListener("focus", focus); window.addEventListener("online", focus);
    return () => { window.removeEventListener("focus", focus); window.removeEventListener("online", focus); };
  }, [busy, refresh]);
  async function removeConversation(id: string) {
    if (!key) return;
    removed.current.add(id); pendingDeletes.current.add(id);
    try { localStorage.setItem(`${key}:deleted`, JSON.stringify([...pendingDeletes.current])); }
    catch { setStorageError(true); setSyncError("Deletion is queued in memory, but this browser cannot save the offline deletion queue. Stay online until it completes."); }
    setChats(local => local.filter(chat => chat.id !== id));
    await refresh();
  }
  const openConversation = useCallback(async (id: string) => {
    if (!userId) return;
    setOpening(true);
    try {
      const value = await conversationRequest(`/${id}`);
      if (owner.current !== userId) return;
      const loaded = displayCloudConversation(value.conversation);
      setChats(local => local.map(chat => chat.id === id && !chat.cloudDirty && !removed.current.has(id) ? loaded : chat));
    } catch (error) { if (owner.current === userId) setSyncError(error instanceof Error ? error.message : "Could not open cloud conversation."); }
    finally { if (owner.current === userId) setOpening(false); }
  }, [userId]);
  return { chats, setChats, historyReady, storageError, syncError, refresh, removeConversation, openConversation, opening };
}
