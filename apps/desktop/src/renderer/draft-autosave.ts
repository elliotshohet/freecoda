export type SavedDraft = { key: string; text: string; revision: number };
/** The service owns account/scope validation; this controller protects late loads and typing. */
export function createDraftAutosave(prompt: HTMLTextAreaElement, options: {
  load(): Promise<SavedDraft>;
  save(draft: SavedDraft): Promise<{ saved: boolean }>;
  signal: AbortSignal;
}) {
  const status = document.createElement("span");
  status.className = "draft-save-status";
  status.setAttribute("role", "status");
  prompt.closest("form")!.append(status);
  let scope = "", generation = 0, revision = 0, key = "", observed = prompt.value;
  let loading: Promise<void> | undefined, queue: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false, edits = 0;
  const persist = async () => {
    clearTimeout(timer);
    await loading;
    if (!key && dirty) throw Error("Draft storage is not ready. Keep this window open and retry.");
    if (!key || !dirty) return;
    const value = prompt.value, current = generation;
    const draft = { key, text: value, revision: ++revision };
    dirty = false;
    status.textContent = "Saving draft…";
    const save = async () => {
      try {
        const result = await options.save(draft);
        if (current !== generation) return;
        if (!result.saved) throw Error("Draft scope changed before saving.");
        if (prompt.value === value && !dirty) status.textContent = value ? "Draft saved on this device" : "";
      } catch (error) {
        if (current === generation) { dirty = true; status.textContent = "Draft not saved. Keep this window open and retry."; }
        throw error;
      }
    };
    queue = queue.then(save, save);
    await queue;
  };
  const changed = () => {
    if (prompt.value === observed) return;
    observed = prompt.value; edits++; dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => void persist().catch(() => {}), 200);
  };
  const update = (next: string, canLoad = true) => {
    if (scope !== next) {
      scope = next; generation++; clearTimeout(timer);
      key = ""; revision = 0; dirty = false; loading = undefined;
      prompt.value = ""; observed = ""; status.textContent = "";
    }
    if (!next || key || loading || !canLoad) { if (key) changed(); return; }
    const current = generation, startEdits = edits;
    status.textContent = "Restoring draft…";
    loading = options.load().then(draft => {
      if (current !== generation || draft.key !== scope) return;
      key = draft.key; revision = draft.revision;
      if (edits === startEdits && !dirty) {
        prompt.value = draft.text; observed = draft.text;
        prompt.dispatchEvent(new Event("input", { bubbles: true }));
        status.textContent = draft.text ? "Draft restored" : "";
      }
    }).catch(() => { if (current === generation) status.textContent = "Draft could not be restored. Keep this window open."; })
      .finally(() => { if (current === generation) { loading = undefined; if (dirty && key) void persist().catch(() => {}); } });
  };
  prompt.addEventListener("input", changed, { signal: options.signal });
  prompt.addEventListener("blur", () => void persist().catch(() => {}), { signal: options.signal });
  options.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return {
    update,
    changed,
    migrate(from: string, to: string) {
      if (!from || !to || scope !== from || from === to) return;
      scope = to; generation++; clearTimeout(timer);
      key = ""; revision = 0; dirty = true; observed = prompt.value;
      const current = generation;
      status.textContent = "Saving draft…";
      loading = options.load().then(draft => {
        if (current !== generation) return;
        if (draft.key !== to) throw Error("Draft scope changed while saving.");
        key = to; revision = draft.revision;
      }).catch(() => {
        if (current === generation) status.textContent = "Draft not saved. Keep this window open and retry.";
      }).finally(() => {
        if (current === generation) { loading = undefined; if (key) void persist().catch(() => {}); }
      });
    },
    async flush() { changed(); await persist(); await queue; },
    async clear() { prompt.value = ""; changed(); await persist(); },
  };
}
