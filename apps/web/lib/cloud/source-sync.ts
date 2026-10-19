import { ApiError } from "../http";
import { allowedSource } from "./github";
import type { SourceFile } from "./types";

export function sourceHasChanges(base: SourceFile[], files: SourceFile[]) {
  const normalize = (source: SourceFile[]) => source.filter(file => allowedSource(file.path))
    .map(file => [file.path, file.content, file.encoding || "utf8", file.mode || "100644"])
    .sort((a, b) => a[0]!.localeCompare(b[0]!));
  return JSON.stringify(normalize(base)) !== JSON.stringify(normalize(files));
}

export function requireCleanSync(base: SourceFile[], files: SourceFile[]) {
  if (sourceHasChanges(base, files))
    throw new ApiError(409, "This workspace has unpublished changes. Publish and merge them, or preserve them in another project before pulling.");
}
