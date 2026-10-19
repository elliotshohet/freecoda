export type PromptContext = { mode: string; threadId?: string; root?: string };
export type QueuedPrompt = PromptContext & { text: string };
/** A queued task must never move into another conversation or replace a live draft. */
export function canDeliverQueuedPrompt(item: QueuedPrompt, context: PromptContext, draft: string) {
  return !draft.trim() && item.mode === context.mode && item.threadId === context.threadId && item.root === context.root;
}
/** Retain the head until the main process accepts it, including validation/IPC failures. */
export function settleQueuedPrompt(queue: QueuedPrompt[], accepted: boolean) {
  if (accepted) queue.shift();
  return { paused: !accepted, remaining: queue.length };
}
