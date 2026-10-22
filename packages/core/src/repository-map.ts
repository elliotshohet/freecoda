export type RepositoryMapSource = {
  files(): Promise<string[]>;
  read(file: string): Promise<string>;
};

const MAX_FILES = 120;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_SYMBOLS_PER_FILE = 40;
const sourceExtensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".py", ".java", ".go", ".rs", ".rb", ".php", ".cs", ".swift",
]);

function declaration(line: string, extension: string): string | undefined {
  if (/^\s/.test(line)) return undefined;
  const patterns: RegExp[] = [
    /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/,
    /^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?\s*=/,
  ];
  if (extension === ".py" || extension === ".rb") {
    patterns.push(/^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/);
  }
  if ([".go", ".rs", ".java", ".cs", ".swift", ".php"].includes(extension)) {
    patterns.push(/^(?:pub\s+)?(?:async\s+)?(?:func|fn|struct|enum|trait|interface|class|record|protocol|type)\s+([A-Za-z_$][\w$]*)/);
  }
  for (const pattern of patterns) {
    const match = line.trim().match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

/** Build a small structural index from trusted, non-ignored workspace files. */
export async function repositoryMap(workspace: RepositoryMapSource, options: { maxFiles?: number; signal?: AbortSignal } = {}) {
  const maxFiles = Number.isSafeInteger(options.maxFiles) && options.maxFiles! > 0
    ? Math.min(MAX_FILES, options.maxFiles!) : MAX_FILES;
  options.signal?.throwIfAborted();
  const files = (await workspace.files()).filter((file) =>
    sourceExtensions.has(file.slice(file.lastIndexOf(".")).toLowerCase()),
  );
  const entries: { path: string; symbols: string[] }[] = [];
  let sourceBytes = 0;
  let truncated = files.length > maxFiles;

  for (const file of files.slice(0, maxFiles)) {
    options.signal?.throwIfAborted();
    if (sourceBytes >= MAX_SOURCE_BYTES) {
      truncated = true;
      break;
    }
    let source: string;
    try {
      source = await workspace.read(file);
    } catch {
      options.signal?.throwIfAborted();
      continue;
    }
    const remainingBytes = MAX_SOURCE_BYTES - sourceBytes;
    const bytes = Buffer.byteLength(source);
    if (bytes > remainingBytes) {
      source = Buffer.from(source).subarray(0, remainingBytes).toString("utf8");
      sourceBytes += remainingBytes;
      truncated = true;
    } else {
      sourceBytes += bytes;
    }
    const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
    const symbols: string[] = [];
    for (const line of source.split(/\r?\n/)) {
      const name = declaration(line, extension);
      if (name && !symbols.includes(name)) symbols.push(name);
      if (symbols.length >= MAX_SYMBOLS_PER_FILE) {
        truncated = true;
        break;
      }
    }
    entries.push({ path: file, symbols });
    if (sourceBytes >= MAX_SOURCE_BYTES) break;
  }
  return {
    files: entries,
    truncated,
    limits: { files: maxFiles, sourceBytes: MAX_SOURCE_BYTES },
    note: "Paths and top-level declaration names only; source is not executed.",
  };
}
