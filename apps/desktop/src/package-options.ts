/** The packaging entrypoint can produce files, never publish them. */
export function packagingArguments(input: readonly string[]) {
  if (input[0] === "publish") throw new Error("Use the reviewed release workflow to publish desktop updates.");
  const args: string[] = [];
  for (let i = 0; i < input.length; i++) {
    const value = input[i];
    if (value === "--") continue;
    if (value === "--publish" || value === "-p") {
      if (input[i + 1] && !input[i + 1].startsWith("-")) i++;
      continue;
    }
    if (value.startsWith("--publish=") || value.startsWith("-p=")) continue;
    args.push(value);
  }
  return [...args, "--publish", "never"];
}
