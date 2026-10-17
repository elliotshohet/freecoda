import { ApiError } from "../http";
import type { SourceFile } from "./types";
/** Validate the complete proposed archive before touching a live workspace. */
export function proposedSourceEdit(
  files: SourceFile[],
  path: string,
  content: string,
) {
  const original = files.find((file) => file.path === path);
  const next = files
    .filter((file) => file.path !== path)
    .concat({
      path,
      content,
      ...(original?.mode ? { mode: original.mode } : {}),
    });
  if (
    next.length > 10000 ||
    next.reduce(
      (sum, file) =>
        sum +
        Buffer.byteLength(
          file.content,
          file.encoding === "base64" ? "base64" : "utf8",
        ),
      0,
    ) > 100_000_000
  )
    throw new ApiError(413, "Project source exceeds 100 MB or 10,000 files.");
  return next;
}
