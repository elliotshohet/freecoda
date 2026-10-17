import { test, expect } from "bun:test";
import { publicationChanges } from "../apps/web/lib/cloud/github";

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
