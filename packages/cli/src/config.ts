import { homedir } from "node:os";
import path from "node:path";
import {
  mkdir,
  readFile,
  writeFile,
  chmod,
  lstat,
  rename,
  unlink,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
const provider = z.object({
  baseURL: z.string(),
  model: z.string(),
  apiKey: z.string().optional(),
});
const configSchema = z.object({
  server: z.string().default("https://freecoda.com"),
  token: z.string().optional(),
  provider: provider.optional(),
  trustedRoots: z.array(z.string()).default([]),
  theme: z.enum(["auto", "dark", "light"]).default("auto"),
});
export type ThemePreference = "auto" | "dark" | "light";
export type Config = z.infer<typeof configSchema>;
export const stateDir = () =>
  process.env.FREECODA_CONFIG_DIR ||
  path.join(homedir(), ".config", "freecoda");
async function ensureDir(dir: string) {
  try {
    if ((await lstat(dir)).isSymbolicLink())
      throw new Error("Refusing symlinked configuration directory.");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}
export async function savePrivate(filename: string, value: unknown) {
  const dir = path.dirname(filename);
  await ensureDir(dir);
  try {
    if ((await lstat(filename)).isSymbolicLink())
      throw new Error("Refusing symlinked configuration file.");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const temp = path.join(dir, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temp, filename);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
export async function loadConfig(): Promise<Config> {
  try {
    const file = path.join(stateDir(), "config.json");
    if ((await lstat(file)).isSymbolicLink())
      throw new Error("Refusing symlinked configuration file.");
    return configSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return {
        server: "https://freecoda.com",
        trustedRoots: [],
        theme: "auto",
      };
    throw new Error(
      "Could not read Freecoda configuration. Check its format and permissions.",
    );
  }
}
export async function saveConfig(config: Config) {
  await savePrivate(path.join(stateDir(), "config.json"), config);
}
export function historyFile(root: string) {
  return path.join(
    stateDir(),
    "sessions",
    createHash("sha256").update(root).digest("hex") + ".json",
  );
}
