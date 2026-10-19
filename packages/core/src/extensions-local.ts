import { randomUUID } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  lstat,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import {
  parseExtensionRegistry,
  emptyExtensionRegistry,
  installRemoteSkill,
  installSkillFromText,
  type ExtensionRegistry,
} from "./extensions";
export async function loadExtensionRegistry(
  filename: string,
): Promise<ExtensionRegistry> {
  try {
    if ((await lstat(filename)).isSymbolicLink())
      throw new Error("Refusing a symlinked extension registry.");
    const contents = await readFile(filename, "utf8");
    if (Buffer.byteLength(contents) > 512_000)
      throw new Error("Extension registry is too large.");
    return parseExtensionRegistry(JSON.parse(contents));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return emptyExtensionRegistry();
    throw error;
  }
}
export async function saveExtensionRegistry(
  filename: string,
  registry: ExtensionRegistry,
) {
  const value = parseExtensionRegistry(registry);
  const directory = path.dirname(filename);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error("Refusing a symlinked extension directory.");
  const temp = path.join(directory, `.${randomUUID()}.tmp`);
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
export async function installSkill(
  registry: ExtensionRegistry,
  input: { source: string; name?: string; allowLocal?: boolean },
): Promise<ExtensionRegistry> {
  if (/^https?:\/\//.test(input.source))
    return installRemoteSkill(registry, input);
  let source = input.source;
  let instructions: string;
  const files: Record<string, string> = {};
  if (!input.allowLocal)
    throw new Error("Hosted installs require an HTTPS SKILL.md URL.");
  source = path.resolve(source);
  if ((await lstat(source)).isSymbolicLink())
    throw new Error("Skill source cannot be a symlink.");
  if ((await lstat(source)).isDirectory())
    source = path.join(source, "SKILL.md");
  if ((await lstat(source)).isSymbolicLink())
    throw new Error("SKILL.md cannot be a symlink.");
  instructions = await readFile(source, "utf8");
  if (Buffer.byteLength(instructions) > 48_000)
    throw new Error("SKILL.md exceeds 48KB.");
  let size = Buffer.byteLength(instructions),
    count = 0;
  async function copy(dir: string, prefix = "") {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (
        item.name.startsWith(".") ||
        item.name === "SKILL.md" ||
        item.isSymbolicLink() ||
        /^(node_modules|dist|vendor|credentials|secrets|service[-_]account|id_rsa|id_ed25519)(\.|$)/i.test(
          item.name,
        )
      )
        continue;
      const relative = prefix + item.name;
      if (item.isDirectory()) {
        if (prefix.split("/").length < 4)
          await copy(path.join(dir, item.name), relative + "/");
      } else if (
        item.isFile() &&
        /\.(md|txt|json|yaml|yml|csv|ts|js|py|sh)$/i.test(item.name)
      ) {
        const file = path.join(dir, item.name);
        if ((await lstat(file)).size > 48_000)
          throw new Error("Skill support file exceeds 48KB.");
        const content = await readFile(file, "utf8");
        size += Buffer.byteLength(content);
        count++;
        if (size > 128_000 || count > 40)
          throw new Error("Skill support files exceed 128KB or 40 files.");
        files[relative] = content;
      }
    }
  }
  await copy(path.dirname(source));

  const name =
    input.name ||
    instructions.match(/^name:\s*["']?([^\r\n"']+)/m)?.[1]?.trim() ||
    path.basename(path.dirname(source)) ||
    "Installed skill";
  const installed = installSkillFromText(registry, {
    name,
    instructions,
    source,
  });
  return parseExtensionRegistry({
    ...installed,
    skills: installed.skills.map((s) =>
      s.source === source ? { ...s, files } : s,
    ),
  });
}
