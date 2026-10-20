/** Suggestions only edit the draft. They never submit a form or invoke a tool. */
export function canAcceptSuggestion(value: string, prefix: string, completion: string, start: number, end: number): boolean {
  return !!completion && value === prefix && start === value.length && end === value.length && !value.trimStart().startsWith("/");
}
export function createComposerSuggestions(prompt: HTMLTextAreaElement, options: {
  enabled(): boolean;
  contextKey(): string;
  request(prefix: string): Promise<{ completion: string }>;
  cancel(): Promise<unknown>;
  describeError(error: unknown): string;
  signal: AbortSignal;
}) {
  const overlay = document.createElement("pre");
  overlay.className = "composer-ghost";
  overlay.setAttribute("aria-hidden", "true");
  overlay.hidden = true;
  prompt.after(overlay);
  const status = document.createElement("span");
  status.id = "composer-suggestion-status";
  status.className = "composer-suggestion-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  prompt.closest("form")!.append(status);
  prompt.setAttribute("aria-describedby", status.id);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let prefix = "", completion = "", dismissed: string | undefined;
  let context = options.contextKey();
  const placeholder = prompt.placeholder;
  const clear = () => {
    clearTimeout(timer);
    generation++;
    prefix = completion = "";
    overlay.hidden = true;
    prompt.placeholder = placeholder;
    status.textContent = "";
    void options.cancel().catch(() => {});
  };
  const eligible = () => options.enabled() && !prompt.disabled && document.activeElement === prompt && prompt.value.length <= 2000 && !prompt.value.trimStart().startsWith("/") && prompt.selectionStart === prompt.value.length && prompt.selectionEnd === prompt.value.length && dismissed !== prompt.value;
  const metrics = () => {
    const style = getComputedStyle(prompt);
    overlay.style.height = `${prompt.offsetHeight}px`;
    overlay.style.top = `${prompt.offsetTop}px`;
    overlay.style.width = `${prompt.offsetWidth}px`;
    overlay.style.font = style.font;
    overlay.style.padding = style.padding;
    overlay.style.letterSpacing = style.letterSpacing;
  };
  const observer = new ResizeObserver(metrics); observer.observe(prompt);
  options.signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  const scroll = () => { overlay.scrollTop = prompt.scrollTop; overlay.scrollLeft = prompt.scrollLeft; };
  const schedule = () => {
    clear();
    if (!eligible()) return;
    const current = generation, value = prompt.value, scope = options.contextKey();
    timer = setTimeout(async () => {
      if (!eligible() || current !== generation || scope !== options.contextKey()) return;
      status.textContent = "Generating an AI suggestion…";
      try {
        const result = await options.request(value);
        if (current !== generation || scope !== options.contextKey() || !eligible() || prompt.value !== value) return;
        if (!result.completion || result.completion.length + value.length > prompt.maxLength) { status.textContent = ""; return; }
        prefix = value; completion = result.completion;
        const typed = document.createElement("span"); typed.className = "composer-ghost-prefix"; typed.textContent = value;
        overlay.replaceChildren(typed, document.createTextNode(completion));
        overlay.hidden = false;
        prompt.placeholder = "";
        status.textContent = "AI suggestion · Tab to insert · Esc to dismiss";
        metrics(); scroll();
      } catch (error) {
        if (current === generation && eligible()) status.textContent = `AI suggestions unavailable: ${options.describeError(error)}`;
      }
    }, 1500);
  };
  prompt.addEventListener("input", () => { if (dismissed !== prompt.value) dismissed = undefined; schedule(); }, { signal: options.signal });
  prompt.addEventListener("focus", schedule, { signal: options.signal });
  prompt.addEventListener("blur", clear, { signal: options.signal });
  prompt.addEventListener("scroll", scroll, { passive: true, signal: options.signal });
  prompt.addEventListener("select", () => { if (!eligible()) clear(); }, { signal: options.signal });
  prompt.addEventListener("keydown", event => {
    if (event.isComposing) { clear(); return; }
    if (event.key === "Escape" && completion) { dismissed = prompt.value; clear(); return; }
    if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || !eligible() || !canAcceptSuggestion(prompt.value, prefix, completion, prompt.selectionStart, prompt.selectionEnd)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const value = completion;
    clear();
    prompt.setRangeText(value, prompt.selectionStart, prompt.selectionEnd, "end");
    dismissed = prompt.value;
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
    status.textContent = "Suggestion inserted. Review and send when ready.";
  }, { capture: true, signal: options.signal });
  options.signal.addEventListener("abort", clear, { once: true });
  return { update() { const next = options.contextKey(); if (context !== next) { context = next; dismissed = undefined; clear(); if (eligible()) schedule(); } } };
}
