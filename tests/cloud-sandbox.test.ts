import { test, expect } from "bun:test";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SOURCE_HELPER,
  validSourcePath,
  validateSourceFiles,
  sourceHash,
  previewInstallPlan,
} from "../apps/web/lib/cloud/sandbox";
import {
  createPreviewTicket,
  previewPublicKey,
  verifyPreviewTicket,
  PREVIEW_PROXY_SOURCE,
} from "../apps/web/lib/cloud/preview-proxy";

test("source operations exclude credentials and symlinks and preserve concurrent edits", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-cloud-source-"));
  const invoke = (data: Record<string, unknown>) => {
    const result = Bun.spawnSync(["python3", "-I", "-c", SOURCE_HELPER], {
      stdin: Buffer.from(JSON.stringify({ root, ...data })),
    });
    return JSON.parse(result.stdout.toString());
  };
  try {
    await writeFile(path.join(root, "answer.ts"), "export const answer = 1;");
    await writeFile(path.join(root, ".env.production"), "SECRET=private");
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, "node_modules", "cached.js"), "excluded");
    await symlink(
      path.join(root, ".env.production"),
      path.join(root, "linked.ts"),
    );
    const listed = invoke({ op: "list" });
    expect(listed.ok).toBe(true);
    expect(listed.value.map((f: { path: string }) => f.path)).toEqual([
      "answer.ts",
    ]);
    const file = invoke({ op: "read", path: "answer.ts" }).value;
    expect(file.hash).toBe(sourceHash(file.content));
    const replacement = "export const answer = 2;";
    expect(
      invoke({
        op: "edit",
        path: "answer.ts",
        content: replacement,
        expectedHash: file.hash,
      }).ok,
    ).toBe(true);
    expect(
      invoke({
        op: "edit",
        path: "answer.ts",
        content: "overwrite",
        expectedHash: file.hash,
      }).ok,
    ).toBe(false);
    expect(await readFile(path.join(root, "answer.ts"), "utf8")).toBe(
      replacement,
    );
    expect(invoke({ op: "read", path: "../outside" }).ok).toBe(false);
    expect(invoke({ op: "read", path: "linked.ts" }).ok).toBe(false);
    expect(invoke({ op: "read", path: ".env.production" }).ok).toBe(false);
    expect(invoke({ op: "export" }).value).toEqual([
      { path: "answer.ts", content: replacement },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source imports enforce source-only paths and aggregate 100 MB cap", () => {
  for (const name of [
    "../file.ts",
    "/etc/passwd",
    ".env.local",
    "src/../../file.ts",
    "node_modules/a.js",
    ".ssh/key",
    "secrets.json",
    "src\\file.ts",
  ])
    expect(() => validSourcePath(name)).toThrow();
  expect(() =>
    validateSourceFiles([
      { path: "a.ts", content: "a" },
      { path: "a.ts", content: "b" },
    ]),
  ).toThrow("Duplicate");
  expect(
    validateSourceFiles([
      { path: "src/file.ts", content: "hello" },
    ])[0].content.toString(),
  ).toBe("hello");
  expect(() =>
    validateSourceFiles(
      Array.from({ length: 101 }, (_, i) => ({
        path: `asset${i}.txt`,
        content: "x".repeat(1024 * 1024),
      })),
    ),
  ).toThrow("100 MB");
});

test("preview tickets require the server signature, correct project and sandbox, and short expiry", () => {
  const previous = process.env.CLOUD_PREVIEW_SECRET;
  process.env.CLOUD_PREVIEW_SECRET =
    "test-preview-signing-secret-long-enough-for-a-fixture";
  try {
    const now = Date.now(),
      key = previewPublicKey(),
      ticket = createPreviewTicket("project-a", "sandbox-a", now);
    expect(
      verifyPreviewTicket(ticket.token, key, "project-a", "sandbox-a", now),
    ).toBe(true);
    expect(
      verifyPreviewTicket(ticket.token, key, "project-b", "sandbox-a", now),
    ).toBe(false);
    expect(
      verifyPreviewTicket(ticket.token, key, "project-a", "sandbox-b", now),
    ).toBe(false);
    expect(
      verifyPreviewTicket(
        ticket.token + "modified",
        key,
        "project-a",
        "sandbox-a",
        now,
      ),
    ).toBe(false);
    expect(
      verifyPreviewTicket(
        ticket.token,
        key,
        "project-a",
        "sandbox-a",
        now + 301000,
      ),
    ).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.CLOUD_PREVIEW_SECRET;
    else process.env.CLOUD_PREVIEW_SECRET = previous;
  }
});

test("trusted preview proxy refuses anonymous access and strips ticket credentials from app requests", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-proxy-"));
  const previous = process.env.CLOUD_PREVIEW_SECRET;
  process.env.CLOUD_PREVIEW_SECRET =
    "test-preview-signing-secret-long-enough-for-a-fixture";
  let child: ReturnType<typeof Bun.spawn> | undefined;
  const app = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req) =>
      Response.json({
        path: new URL(req.url).pathname,
        cookie: req.headers.get("cookie"),
        authorization: req.headers.get("authorization"),
      }),
  });
  const reserve = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response(),
  });
  const port = reserve.port;
  await reserve.stop(true);
  try {
    await writeFile(path.join(root, "proxy.mjs"), PREVIEW_PROXY_SOURCE);
    await writeFile(
      path.join(root, "config.json"),
      JSON.stringify({
        projectId: "project-a",
        sandboxId: "sandbox-a",
        publicKey: previewPublicKey(),
        port,
        appPort: app.port,
      }),
    );
    child = Bun.spawn(
      ["node", path.join(root, "proxy.mjs"), path.join(root, "config.json")],
      { stdout: "ignore", stderr: "pipe" },
    );
    const base = `http://127.0.0.1:${port}`;
    let anonymous: Response | undefined;
    for (let i = 0; i < 30; i++) {
      try {
        anonymous = await fetch(base);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    expect(anonymous?.status).toBe(401);
    const ticket = createPreviewTicket("project-a", "sandbox-a");
    const entry = await fetch(`${base}/hello?ticket=${ticket.token}`, {
      redirect: "manual",
    });
    expect(entry.status).toBe(303);
    expect(entry.headers.get("set-cookie")).toContain("HttpOnly");
    expect(entry.headers.get("location")).toBe("/hello");
    const response = await fetch(base + "/hello", {
      headers: {
        cookie: `__Host-freecoda_preview=${ticket.token}`,
        Authorization: "must-not-reach-app",
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      path: "/hello",
      cookie: null,
      authorization: null,
    });
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors https://freecoda.com",
    );
  } finally {
    child?.kill();
    await app.stop(true);
    await rm(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.CLOUD_PREVIEW_SECRET;
    else process.env.CLOUD_PREVIEW_SECRET = previous;
  }
});

test("sandbox command output is bounded inside the VM and credentials are excluded", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "freecoda-command-"));
  const root = await realpath(temp);
  const invoke = (command: string, timeoutMs = 5000) => {
    const result = Bun.spawnSync(["python3", "-I", "-c", SOURCE_HELPER], {
      stdin: Buffer.from(
        JSON.stringify({ root, cwd: root, op: "command", command, timeoutMs }),
      ),
      env: { ...process.env, OPENAI_API_KEY: "must-not-reach-child-fixture" },
    });
    return JSON.parse(result.stdout.toString());
  };
  try {
    const output = invoke(
      `python3 -c "import sys;sys.stdout.write('x'*100000);sys.stderr.write('y'*100000)"`,
    );
    expect(output.ok).toBe(true);
    expect(output.value.stdout.length).toBe(32000);
    expect(output.value.stderr.length).toBe(32000);
    const clean = invoke(
      `python3 -c "import os;print(os.getenv('OPENAI_API_KEY','absent'))"`,
    );
    expect(clean.value.stdout.trim()).toBe("absent");
    const timed = invoke("sleep 3", 50);
    expect(timed.value.exitCode).toBe(124);
    expect(timed.value.stderr).toContain("timed out");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("preview bootstrap installs monorepo roots using pinned manager versions", () => {
  const files = [
    { path: "package.json" },
    { path: "bun.lock" },
    { path: "apps/web/package.json" },
  ];
  const bun = previewInstallPlan(
    { workspaces: ["apps/*"], packageManager: "bun@1.3.5" },
    { dependencies: { next: "16.4.2" } },
    files,
    "/home/project/app/apps/web",
  );
  expect(bun.appDirectory).toBe("/home/project/app");
  expect(bun.manager).toBe("bun");
  expect(bun.command).toContain("bun@1.3.5");
  const pnpm = previewInstallPlan(
    { packageManager: "pnpm@9.15.9+sha512.abc123" },
    {},
    [{ path: "pnpm-lock.yaml" }],
    "/home/project/app/apps/web",
  );
  expect(pnpm.manager).toBe("pnpm");
  expect(pnpm.command).toContain("pnpm@9.15.9");
  const yarn = previewInstallPlan(
    { packageManager: "yarn@4.6.0" },
    {},
    [],
    "/home/project/app",
  );
  expect(yarn.command).toContain("@yarnpkg/cli-dist@4.6.0");
  expect(yarn.command).toContain("YARN_ENABLE_SCRIPTS=false");
  const nested = previewInstallPlan(
    { scripts: {} },
    { packageManager: "npm@11.1.0" },
    [{ path: "apps/web/package.json" }],
    "/home/project/app/apps/web",
  );
  expect(nested.appDirectory).toBe("/home/project/app/apps/web");
  expect(() =>
    previewInstallPlan(
      { packageManager: "bun@1.3.5;curl attacker" },
      {},
      [],
      "/home/project/app",
    ),
  ).toThrow("pinned");
});

test("concurrent sandbox edits with the same base hash permit only one writer", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "freecoda-concurrent-source-"),
  );
  try {
    const content = "original source";
    await writeFile(path.join(root, "shared.ts"), content);
    const write = (replacement: string) => {
      const process = Bun.spawn(["python3", "-I", "-c", SOURCE_HELPER], {
        stdin: Buffer.from(
          JSON.stringify({
            root,
            op: "edit",
            path: "shared.ts",
            content: replacement,
            expectedHash: sourceHash(content),
          }),
        ),
        stdout: "pipe",
        stderr: "pipe",
      });
      return new Response(process.stdout)
        .text()
        .then((text) => JSON.parse(text));
    };
    const results = await Promise.all([
      write("first writer"),
      write("second writer"),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok).error).toContain("changed");
    expect(["first writer", "second writer"]).toContain(
      await readFile(path.join(root, "shared.ts"), "utf8"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated compiler and Workflow artifacts never enter exported source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-generated-source-"));
  const generated = [
    ".swc/cache/binary.wasm",
    "apps/web/.swc/plugins/cache.bin",
    "next-env.d.ts",
    "apps/web/next-env.d.ts",
    ".well-known/workflow/v1/generated.js",
    "apps/web/.well-known/workflow/v1/flows/compiled.js",
  ];
  const source = [
    "src/index.ts",
    ".well-known/security.txt",
    "apps/web/.well-known/assetlinks.json",
  ];
  try {
    for (const file of [...generated, ...source]) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), "fixture source");
    }
    for (const file of generated) expect(() => validSourcePath(file)).toThrow();
    for (const file of source) expect(validSourcePath(file)).toBe(file);
    for (const op of ["list", "export"]) {
      const result = Bun.spawnSync(["python3", "-I", "-c", SOURCE_HELPER], {
        stdin: Buffer.from(JSON.stringify({ root, op })),
      });
      const response = JSON.parse(result.stdout.toString());
      expect(response.ok).toBe(true);
      expect(
        response.value.map((file: { path: string }) => file.path).sort(),
      ).toEqual([...source].sort());
    }
    for (const file of generated) {
      const result = Bun.spawnSync(["python3", "-I", "-c", SOURCE_HELPER], {
        stdin: Buffer.from(JSON.stringify({ root, op: "read", path: file })),
      });
      expect(JSON.parse(result.stdout.toString()).ok).toBe(false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
