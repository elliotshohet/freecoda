import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  writeBundledNotices,
  type LicenseFallback,
} from "../scripts/bundled-notices";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-license-test-"));
  roots.push(root);
  const pkg = path.join(
    root,
    "node_modules/.bun/example@1.0.0/node_modules/@fixture/example",
  );
  const out = path.join(root, "dist");
  await mkdir(pkg, { recursive: true });
  await mkdir(out);
  await writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({
      name: "@fixture/example",
      version: "1.0.0",
      license: "MIT",
    }),
  );
  const sourceMap = path.join(out, "bundle.js.map");
  await writeFile(
    sourceMap,
    JSON.stringify({
      sources: [
        path.relative(out, path.join(pkg, "index.js")),
        "../src/own.ts",
      ],
    }),
  );
  return {
    root,
    pkg,
    sourceMap,
    outputPath: path.join(out, "THIRD_PARTY_NOTICES.txt"),
  };
}
test("includes exact LICENSE-MIT and NOTICE text only for bundled inputs; deterministic deduplication", async () => {
  const f = await fixture();
  const license =
    "Copyright fixture author\r\nMIT terms with exact spacing. \r\n";
  const notice = "An additional upstream NOTICE.\n";
  await writeFile(path.join(f.pkg, "LICENSE-MIT"), license);
  await writeFile(path.join(f.pkg, "NOTICE.txt"), notice);
  const unused = path.join(f.root, "node_modules/unused");
  await mkdir(unused);
  await writeFile(
    path.join(unused, "package.json"),
    JSON.stringify({ name: "unused", version: "9.0.0" }),
  );
  const result = await writeBundledNotices({
    sourceMaps: [f.sourceMap, f.sourceMap],
    outputPath: f.outputPath,
    fallbacks: {},
  });
  expect(result.packages).toEqual(["@fixture/example@1.0.0"]);
  const text = await readFile(f.outputPath, "utf8");
  expect(text).toContain(license);
  expect(text).toContain(notice);
  expect(text).not.toContain("unused");
  await writeBundledNotices({
    sourceMaps: [f.sourceMap],
    outputPath: f.outputPath,
    fallbacks: {},
  });
  expect(await readFile(f.outputPath, "utf8")).toBe(text);
});
test("missing license fails closed even when a NOTICE exists", async () => {
  const f = await fixture();
  await writeFile(path.join(f.pkg, "NOTICE"), "Copyright only.\n");
  await expect(
    writeBundledNotices({
      sourceMaps: [f.sourceMap],
      outputPath: f.outputPath,
      fallbacks: {},
    }),
  ).rejects.toThrow("Missing reviewed license text");
});
test("reviewed fallback includes exact provenance and rejects a later package version", async () => {
  const f = await fixture();
  const fallback: LicenseFallback = {
    license: "MIT",
    sourceUrls: ["https://example.invalid/commit/license"],
    note: "Fixture canonical reference, not an upstream copyright claim.",
    text: "Exact primary-source reference text.\n",
  };
  const fallbacks = { "@fixture/example@1.0.0": fallback };
  await writeBundledNotices({
    sourceMaps: [f.sourceMap],
    outputPath: f.outputPath,
    fallbacks,
  });
  const output = await readFile(f.outputPath, "utf8");
  expect(output).toContain(fallback.sourceUrls[0]);
  expect(output).toContain(fallback.note);
  expect(output).toContain(fallback.text);
  await writeFile(
    path.join(f.pkg, "package.json"),
    JSON.stringify({
      name: "@fixture/example",
      version: "1.0.1",
      license: "MIT",
    }),
  );
  await expect(
    writeBundledNotices({
      sourceMaps: [f.sourceMap],
      outputPath: f.outputPath,
      fallbacks,
    }),
  ).rejects.toThrow("@fixture/example@1.0.1");
});
test("refuses empty input maps and blank installed license files", async () => {
  const f = await fixture();
  await writeFile(path.join(f.pkg, "LICENSE"), "  \n");
  await expect(
    writeBundledNotices({
      sourceMaps: [f.sourceMap],
      outputPath: f.outputPath,
      fallbacks: {},
    }),
  ).rejects.toThrow("Empty bundled");
  await writeFile(f.sourceMap, JSON.stringify({ sources: ["../src/own.ts"] }));
  await expect(
    writeBundledNotices({
      sourceMaps: [f.sourceMap],
      outputPath: f.outputPath,
      fallbacks: {},
    }),
  ).rejects.toThrow("No bundled third-party");
});
