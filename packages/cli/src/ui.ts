import { createInterface, type Interface } from "node:readline/promises";
import c from "picocolors";
import type { Approval } from "@freecoda/core";
let reader: Interface | undefined;
export function closeReader() {
  reader?.close();
  reader = undefined;
}
export async function ask(prompt: string) {
  if (!process.stdin.isTTY)
    throw new Error("This action requires an interactive terminal.");
  reader ??= createInterface({ input: process.stdin, output: process.stdout });
  return (await reader.question(prompt)).trim();
}
export async function secret(prompt: string) {
  if (!process.stdin.isTTY)
    throw new Error("Use FREECODA_PROVIDER_KEY in a noninteractive terminal.");
  closeReader();
  process.stdout.write(prompt);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (data: Buffer) => {
      for (const char of data.toString()) {
        if (char === "\u0003") {
          done();
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          done();
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= " ") value += char;
      }
    };
    stdin.on("data", onData);
  });
}
export function approvals(): Approval {
  const allowed = new Set<string>();
  return async (kind, description) => {
    if (allowed.has(kind)) return true;
    console.log(c.dim("\n" + description));
    if (!process.stdin.isTTY) return false;
    const answer = await ask(
      c.yellow(
        `\nAllow ${kind}? [y] once / [s] this category for the session / [n] no: `,
      ),
    );
    if (answer.toLowerCase() === "s") {
      allowed.add(kind);
      return true;
    }
    return answer.toLowerCase() === "y";
  };
}
