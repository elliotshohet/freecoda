export type OwnedVoiceTurnObserver = {
  onController(controller: AbortController): void;
  onReply(text: string): void;
};
/** Voice cancellation is tied to the controller created for this turn, never a shared chat ref. */
export async function runOwnedVoiceTurn(signal: AbortSignal, start: (observer: OwnedVoiceTurnObserver) => Promise<boolean>): Promise<string> {
  let owned: AbortController | undefined;
  let reply = "";
  const cancel = () => owned?.abort();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw Error("Voice turn stopped.");
    const accepted = await start({
      onController(controller) { owned = controller; if (signal.aborted) controller.abort(); },
      onReply(text) { reply = text; },
    });
    if (signal.aborted) throw Error("Voice turn stopped.");
    if (!accepted || !reply) throw Error("Voice reply could not complete. Review the chat before continuing.");
    return reply;
  } finally {
    signal.removeEventListener("abort", cancel);
    owned = undefined;
  }
}
