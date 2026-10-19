import { test, expect } from "bun:test";
import { publicationChanges } from "../apps/web/lib/cloud/github";
import { sourceHasChanges, requireCleanSync } from "../apps/web/lib/cloud/source-sync";

test("upstream pulls preserve additions, deletions, executable modes and binary edits", () => {
  const base = [{ path: "run.sh", content: "echo hello", mode: "100644" as const }, { path: "image.png", content: "YQ==", encoding: "base64" as const }];
  expect(sourceHasChanges(base, [...base].reverse())).toBe(false);
  for (const changed of [base.slice(1), [...base, { path: "new.ts", content: "local" }], [{ ...base[0]!, mode: "100755" as const }, base[1]!], [base[0]!, { ...base[1]!, content: "Yg==" }]]) {
    expect(() => requireCleanSync(base, changed)).toThrow("unpublished changes");
  }
});

test("source policy changes preserve excluded tracked artifacts instead of publishing deletions", () => {
  const base = [
    { path: "app/page.tsx", content: "old page" },
    { path: "next-env.d.ts", content: "tracked generated types" },
    { path: "apps/web/.swc/cache.bin", content: "tracked compiler cache" },
    {
      path: "apps/web/.well-known/workflow/v1/config.json",
      content: "generated workflow config",
    },
    { path: "obsolete.ts", content: "delete this source" },
  ];
  const current = [
    { path: "app/page.tsx", content: "new page" },
    { path: "apps/web/.swc/new-cache.bin", content: "new cache" },
    { path: "next-env.d.ts", content: "regenerated types" },
  ];
  const changes = publicationChanges(base, current);
  expect(changes.changed.map((file) => file.path)).toEqual(["app/page.tsx"]);
  expect(changes.deleted.map((file) => file.path)).toEqual(["obsolete.ts"]);
  // This same function supplies both the reviewed diff and GitHub tree entries.
  expect(
    publicationChanges(
      base.filter((file) => !file.path.includes("next-env")),
      current,
    ),
  ).toEqual(changes);
});
