import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SessionPermissions,
  permissionPreset,
} from "../packages/cli/src/permissions";
import {
  Workspace,
  runAgent,
  directModel,
  runShell,
} from "../packages/core/src";

test("permissions default is session-only; categories, one-off answers and switching are enforced", async () => {
  const answers = ["s", "n", "y", "n"];
  const prompts: string[] = [],
    statuses: string[] = [];
  const policy = new SessionPermissions(
    async (kind) => {
      prompts.push(kind);
      return answers.shift()!;
    },
    (value) => statuses.push(value),
  );
  expect(policy.preset).toBe("default");
  expect(await policy.approve("write", "fixture")).toBe(true);
  expect(await policy.approve("write", "fixture")).toBe(true);
  expect(policy.describe()).toContain("ask before commands");
  expect(await policy.approve("shell", "fixture")).toBe(false);
  expect(await policy.approve("shell", "fixture")).toBe(true);
  expect(await policy.approve("shell", "fixture")).toBe(false);
  expect(prompts).toEqual(["write", "shell", "shell", "shell"]);
  policy.setPreset("read-only");
  expect(await policy.approve("write", "fixture")).toBe(false);
  expect(await policy.approve("shell", "fixture")).toBe(false);
  policy.setPreset("full-access");
  expect(await policy.approve("write", "fixture")).toBe(true);
  expect(await policy.approve("shell", "fixture")).toBe(true);
  expect(prompts).toHaveLength(4);
  policy.setPreset("default");
  expect(policy.describe()).toBe("Default · ask before edits and commands");
  expect(statuses.at(-1)).toBe(policy.describe());
  expect(new SessionPermissions(async () => "n").preset).toBe("default");
  expect(permissionPreset("1")).toBe("read-only");
  expect(permissionPreset("2")).toBe("default");
  expect(permissionPreset("3")).toBe("full-access");
  expect(permissionPreset("unrestricted")).toBeUndefined();
});

test("an in-flight approval cannot reinstate grants after a preset switch", async () => {
  let answer!: (value: string) => void;
  const policy = new SessionPermissions(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const pending = policy.approve("write", "fixture");
  policy.setPreset("read-only");
  answer("s");
  expect(await pending).toBe(false);
  policy.setPreset("default");
  expect(policy.describe()).toBe("Default · ask before edits and commands");
});

test("real workspace edits and shell effects obey read-only/full-access without prompts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-permissions-"));
  const policy = new SessionPermissions(async () => {
    throw Error("Unexpected approval prompt");
  });
  try {
    await writeFile(path.join(root, "fixture.txt"), "before");
    const ws = await Workspace.open(root, policy.approve);
    await ws.read("fixture.txt");
    policy.setPreset("read-only");
    await ws.replace("fixture.txt", "before", "after");
    expect(await readFile(path.join(root, "fixture.txt"), "utf8")).toBe(
      "before",
    );
    expect(
      (await runShell("echo fixture", root, policy.approve)).exitCode,
    ).toBeNull();
    policy.setPreset("full-access");
    await ws.replace("fixture.txt", "before", "after");
    expect(await readFile(path.join(root, "fixture.txt"), "utf8")).toBe(
      "after",
    );
    expect(
      (await runShell("echo fixture", root, policy.approve)).output,
    ).toContain("fixture");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("read-only preset and explicit plan/review omit mutation tools even with full-access approvals", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "freecoda-permission-tools-"));
  const catalogs: string[][] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const body = (await req.json()) as any;
      catalogs.push(body.tools.map((tool: any) => tool.function.name).sort());
      return new Response(
        "data: " +
          JSON.stringify({
            id: "fixture",
            model: "fixture",
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "Read-only fixture." },
                finish_reason: "stop",
              },
            ],
          }) +
          "\n\ndata: [DONE]\n\n",
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  const policy = new SessionPermissions(async () => {
    throw Error("Unexpected approval");
  });
  try {
    for (const [preset, mode] of [
      ["read-only", "build"],
      ["full-access", "plan"],
      ["full-access", "review"],
    ] as const) {
      policy.setPreset(preset);
      await runAgent({
        root,
        model: directModel(`http://127.0.0.1:${server.port}/v1`, "fixture", ""),
        messages: [{ role: "user", content: "Fixture task" }],
        mode: policy.effectiveMode(mode),
        approve: policy.approve,
      });
    }
    expect(catalogs).toHaveLength(3);
    for (const tools of catalogs)
      expect(tools).toEqual(["list_files", "read_file", "search"]);
    await runAgent({
      root,
      model: directModel(`http://127.0.0.1:${server.port}/v1`, "fixture", ""),
      messages: [{ role: "user", content: "Fixture task" }],
      mode: "plan",
      disabledTools: ["read_file", "shell"],
      approve: policy.approve,
    });
    expect(catalogs.at(-1)).toEqual(["list_files", "search"]);
  } finally {
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
