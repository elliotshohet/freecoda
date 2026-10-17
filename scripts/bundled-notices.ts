import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type LicenseFallback = {
  license: string;
  sourceUrls: string[];
  note: string;
  text: string;
  upstreamMetadata?: Record<string, unknown>;
};
type Fallbacks = Record<string, LicenseFallback>;
const defaultFallbackFile = fileURLToPath(
  new URL("../legal/bundled-license-fallbacks.json", import.meta.url),
);
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Collect only installed third-party packages whose files actually appear in build maps. */
export async function writeBundledNotices(options: {
  sourceMaps: string[];
  outputPath: string;
  fallbacks?: Fallbacks;
}): Promise<{ packages: string[] }> {
  const fallbacks: Fallbacks =
    options.fallbacks ??
    JSON.parse(await readFile(defaultFallbackFile, "utf8"));
  const packageRoots = new Set<string>();
  for (const mapFile of options.sourceMaps) {
    const map = JSON.parse(await readFile(mapFile, "utf8"));
    if (
      !Array.isArray(map.sources) ||
      !map.sources.every((source: unknown) => typeof source === "string")
    )
      throw new Error(`Invalid build source map: ${path.basename(mapFile)}`);
    for (const source of map.sources as string[]) {
      const absolute = path.resolve(
        path.dirname(mapFile),
        map.sourceRoot || "",
        source,
      );
      const marker = `${path.sep}node_modules${path.sep}`;
      const index = absolute.lastIndexOf(marker);
      if (index < 0) continue; // First-party and vendored code retain the root LICENSE/NOTICE.
      const remaining = absolute.slice(index + marker.length).split(path.sep);
      const count = remaining[0].startsWith("@") ? 2 : 1;
      if (remaining.length <= count)
        throw new Error("Malformed third-party source-map path.");
      packageRoots.add(
        path.join(
          absolute.slice(0, index + marker.length),
          ...remaining.slice(0, count),
        ),
      );
    }
  }
  const sections = new Map<string, string>();
  for (const root of [...packageRoots].sort(order)) {
    const metadata = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    );
    if (
      typeof metadata.name !== "string" ||
      typeof metadata.version !== "string"
    )
      throw new Error("Bundled dependency has no package name/version.");
    const id = `${metadata.name}@${metadata.version}`;
    const files = (await readdir(root, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort(order);
    const hasLicense = files.some((file) =>
      /^(?:licen[cs]e|copying)(?:[._-]|$)/i.test(file),
    );
    let section = `${id}\nDeclared license: ${typeof metadata.license === "string" ? metadata.license : JSON.stringify(metadata.license ?? "unspecified")}\n`;
    for (const file of files) {
      const text = await readFile(path.join(root, file), "utf8");
      if (!text.trim())
        throw new Error(`Empty bundled dependency notice: ${id}/${file}`);
      section += `\n--- ${file} (installed package, verbatim) ---\n${text}${text.endsWith("\n") ? "" : "\n"}`;
    }
    if (!hasLicense) {
      const fallback = fallbacks[id];
      if (
        !fallback ||
        fallback.license !== metadata.license ||
        !fallback.text.trim() ||
        !fallback.note.trim() ||
        !fallback.sourceUrls.length ||
        fallback.sourceUrls.some((url) => !url.startsWith("https://"))
      )
        throw new Error(
          `Missing reviewed license text for bundled dependency ${id}. Add a version-specific upstream fallback.`,
        );
      section += `\n--- Reviewed version-specific license fallback ---\n${fallback.note}\nSources:\n${fallback.sourceUrls.join("\n")}\n`;
      if (fallback.upstreamMetadata)
        section += `Published upstream metadata:\n${JSON.stringify(fallback.upstreamMetadata, null, 2)}\n`;
      section += `\n${fallback.text}${fallback.text.endsWith("\n") ? "" : "\n"}`;
    }
    const previous = sections.get(id);
    if (previous && previous !== section)
      throw new Error(`Conflicting installed license texts for ${id}.`);
    sections.set(id, section);
  }
  const packages = [...sections.keys()].sort(order);
  if (!packages.length)
    throw new Error(
      "No bundled third-party inputs found; refuse an empty notices artifact.",
    );
  const header =
    "THIRD-PARTY NOTICES\n\nGenerated from actual bundled source-map inputs. Installed LICENSE/NOTICE texts are reproduced verbatim. Version-specific fallbacks identify their primary sources and provenance explicitly. Separately shipped runtime components retain their own notices.\n\n";
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(
    options.outputPath,
    header +
      packages
        .map((id) => sections.get(id))
        .join(
          "\n============================================================\n\n",
        ),
  );
  return { packages };
}
