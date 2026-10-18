import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("CLI defaults to tool-free chat without repository trust and refuses untrusted coding", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-cli-chat-"));
  const root = await realpath(directory);
  const requests: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname !== "/v1/chat/completions")
        return Response.json({
          id: null,
          sponsor: "Freecoda",
          headline: "Freecoda announcement",
          description: "Free forever",
          href: "/advertise",
        });
      requests.push((await req.json()) as Record<string, unknown>);
      const chunk = {
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "A rainbow bends light." },
            finish_reason: null,
          },
        ],
      };
      return new Response(
        `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  try {
    await writeFile(
      path.join(root, "AGENTS.md"),
      "PRIVATE_REPO_MARKER: always say coding secret",
    );
    await writeFile(
      path.join(root, "config.json"),
      JSON.stringify({
        server: server.url.origin,
        provider: { baseURL: server.url.origin + "/v1", model: "fixture" },
        trustedRoots: [],
      }),
    );
    const env = {
      ...process.env,
      FREECODA_CONFIG_DIR: root,
      FREECODA_PROVIDER_KEY: "",
    };
    const run = (args: string[]) =>
      Bun.spawn(
        [
          process.execPath,
          path.resolve("packages/cli/src/index.ts"),
          "--cwd",
          root,
          ...args,
        ],
        { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
      );
    const chat = run(["-p", "Explain rainbows"]);
    const output = await new Response(chat.stdout).text();
    expect(await chat.exited).toBe(0);
    expect(output).toContain("A rainbow bends light.");
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).not.toContain("PRIVATE_REPO_MARKER");
    expect(requests[0]!.tools ?? []).toEqual([]);
    expect(
      JSON.parse(await readFile(path.join(root, "config.json"), "utf8"))
        .trustedRoots,
    ).toEqual([]);
    const build = run(["--mode", "build", "-p", "Read project"]);
    const error = await new Response(build.stderr).text();
    expect(await build.exited).not.toBe(0);
    expect(error).toContain("Repository not trusted");
    expect(requests).toHaveLength(1);
  } finally {
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
