import { randomUUID } from "node:crypto";
export type QueuedTurn = { id: string; input: string; context?: unknown };
/** FIFO turns retain identity/context while paused; dequeue happens only at dispatch. */
export class TurnQueue {
  items: QueuedTurn[] = [];
  paused = false;
  add(input: string, context?: unknown) {
    if (this.items.length >= 20) throw Error("Queue is full (20). Remove a queued turn first.");
    const item = { id: randomUUID(), input, context };
    this.items.push(item);
    return item;
  }
  next() { return this.paused ? undefined : this.items.shift(); }
  remove(id: string) {
    const index = this.items.findIndex((item) => item.id === id || item.id.startsWith(id));
    if (index < 0) throw Error("Queued turn not found.");
    this.items.splice(index, 1);
  }
}
