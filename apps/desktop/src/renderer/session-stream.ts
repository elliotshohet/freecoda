export type SessionStream = { runId: string; text: string; revision: number };

/** Cumulative stream revisions make IPC snapshot/delta overlap idempotent. */
export function mergeSessionStream(current: SessionStream | undefined, incoming: SessionStream): SessionStream {
  if (!Number.isSafeInteger(incoming.revision) || incoming.revision < 0) throw Error("Invalid stream revision.");
  if (current?.runId === incoming.runId && current.revision >= incoming.revision) return current;
  return { ...incoming };
}

/** Coalesce only unread events; a new event must survive while replay awaits IPC. */
export function createHydrationBuffer<T>(canReplace: (previous: T, next: T) => boolean) {
  const events: T[] = [];
  let cursor = 0;
  return {
    push(event: T) {
      if (events.length > cursor && canReplace(events[events.length - 1], event)) events[events.length - 1] = event;
      else events.push(event);
    },
    hasNext: () => cursor < events.length,
    take: (): T | undefined => cursor < events.length ? events[cursor++] : undefined,
  };
}
