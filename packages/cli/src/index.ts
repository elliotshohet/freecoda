#!/usr/bin/env node
import { Command } from "commander";
import { realpath, readFile, unlink } from "node:fs/promises";
import { platform, arch } from "node:os";
import c from "picocolors";
import open from "open";
import {
  runAgent,
  directModel,
  hostedModel,
  validateBaseURL,
  redactSecrets,
} from "@freecoda/core";
import type { ModelMessage } from "ai";
import { loadConfig, saveConfig, historyFile, savePrivate } from "./config";
import { ask, secret, approvals, closeReader } from "./ui";
import { showSponsor } from "./ads";
const program = new Command()
  .name("freecoda")
  .description("A local coding agent. Your code, your choices.")
  .version("0.1.0");
async function api(path: string, body?: unknown) {
  const config = await loadConfig();
  const base = validateBaseURL(config.server);
  const response = await fetch(`${base}/api/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const result = await response
    .json()
    .catch(() => ({ error: "Invalid server response." }));
  if (!response.ok)
    throw new Error(result.error || `Server returned ${response.status}.`);
  return result;
}
program
  .command("login")
  .option("--server <url>", "Freecoda server", "https://freecoda.com")
  .action(async (opts) => {
    const config = await loadConfig();
    config.server = validateBaseURL(opts.server);
    delete config.token;
    await saveConfig(config);
    const start = await api("device/start", {
      name: `${platform()} ${arch()} terminal`,
    });
    console.log(
      `\nOpen ${start.verificationUri}\n\nYour code: ${c.bold(start.userCode)}\nOnly approve this code in a browser you control.\n`,
    );
    if (
      process.stdin.isTTY &&
      (await ask("Open the verification page? [y/N] ")) === "y"
    )
      await open(start.verificationUri);
    const expires = Date.now() + start.expiresIn * 1000;
    for (; Date.now() < expires;) {
      await new Promise((r) =>
        setTimeout(r, Math.max(start.interval, 5) * 1000),
      );
      const result = await api("device/poll", { deviceCode: start.deviceCode });
      if (result.status === "pending") continue;
      config.token = result.token;
      await saveConfig(config);
      console.log(
        c.green("Terminal connected. Run freecoda inside a project."),
      );
      return;
    }
    throw new Error("Device code expired. Run freecoda login again.");
  });
program.command("logout").action(async () => {
  const config = await loadConfig();
  if (config.token) {
    await api("devices/logout", {});
    delete config.token;
    await saveConfig(config);
  }
  console.log("Signed out.");
});
program
  .command("usage")
  .action(async () => console.log(JSON.stringify(await api("usage"), null, 2)));
program
  .command("provider")
  .command("configure")
  .action(async () => {
    const config = await loadConfig();
    const baseURL = validateBaseURL(
      await ask("Provider API base URL (HTTPS, or loopback HTTP): "),
    );
    const model = await ask("Exact model ID: ");
    if (!model || model.length > 150)
      throw new Error("A model ID is required.");
    const key =
      process.env.FREECODA_PROVIDER_KEY ||
      (await secret("API key (hidden; leave blank for a local model): "));
    const save = await ask(
      "Save the key locally with owner-only permissions? [y/N] ",
    );
    config.provider = {
      baseURL,
      model,
      ...(save.toLowerCase() === "y" && key ? { apiKey: key } : {}),
    };
    await saveConfig(config);
    console.log(
      "Direct provider configured. Its data policies and pricing apply.",
    );
    if (key && save.toLowerCase() !== "y")
      console.log("Supply FREECODA_PROVIDER_KEY when you run Freecoda.");
  });
program
  .command("hosted")
  .description("Switch from direct BYOK to your hosted Freecoda account")
  .action(async () => {
    const config = await loadConfig();
    delete config.provider;
    await saveConfig(config);
    console.log(
      "Hosted mode selected. Use freecoda login to connect an account.",
    );
  });
program
  .command("history")
  .command("clear")
  .description("Delete saved conversations for the current repository")
  .action(async () => {
    const root = await realpath(process.cwd());
    await unlink(historyFile(root)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
    console.log("Local conversation deleted for this repository.");
  });
program
  .option("--cwd <path>", "Workspace directory")
  .option("--resume", "Resume latest local conversation")
  .option("-p, --prompt <text>", "Run one task")
  .action(async (opts) => {
    const root = await realpath(opts.cwd || process.cwd());
    const config = await loadConfig();
    if (!config.trustedRoots.includes(root)) {
      console.log(
        `\nWorkspace: ${root}\nFreecoda can read non-ignored files and repository instructions. Relevant excerpts go to your AI provider. Writes and shell commands require approval.\n`,
      );
      const trusted = await ask("Trust this repository? [y/N] ");
      if (trusted.toLowerCase() !== "y")
        throw new Error("Repository not trusted. No project files were read.");
      config.trustedRoots.push(root);
      await saveConfig(config);
    }
    let model;
    if (config.provider) {
      const p = config.provider;
      model = directModel(
        p.baseURL,
        p.model,
        process.env.FREECODA_PROVIDER_KEY || p.apiKey || "",
      );
      console.log(
        c.dim(
          `Direct provider: ${new URL(p.baseURL).host} / ${p.model}\nRequests bypass Freecoda. Your provider’s policies apply.`,
        ),
      );
    } else {
      if (!config.token)
        throw new Error(
          "Run freecoda login or freecoda provider configure first.",
        );
      const catalog = await api("models");
      if (!catalog.models?.length)
        throw new Error(
          "Hosted models have not passed launch checks. Use a direct provider for now.",
        );
      const chosen = catalog.models[0];
      model = hostedModel(config.server, chosen.id, config.token);
      console.log(
        c.dim(
          `Hosted model: ${chosen.id} via ${chosen.provider}. Prompt training disallowed.`,
        ),
      );
    }
    console.log(
      c.bold(c.magenta("\n  freecoda")) + c.dim("  Your next big thing.\n"),
    );
    let messages: ModelMessage[] = [];
    if (opts.resume) {
      try {
        const saved = JSON.parse(await readFile(historyFile(root), "utf8"));
        if (saved.root === root && Array.isArray(saved.messages))
          messages = saved.messages;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error("Could not resume the local conversation.");
      }
    }
    const approve = approvals();
    for (;;) {
      const input = opts.prompt || (await ask(c.magenta("› ")));
      if (!input) continue;
      if (["/exit", "/quit"].includes(input)) break;
      if (input === "/new") {
        messages = [];
        await savePrivate(historyFile(root), { root, messages });
        console.log("New conversation.");
        continue;
      }
      if (input === "/usage") {
        console.log(JSON.stringify(await api("usage"), null, 2));
        continue;
      }
      const mode = input.startsWith("/plan")
        ? "plan"
        : input.startsWith("/review")
          ? "review"
          : "build";
      const prompt =
        mode === "review"
          ? `Review current changes and report concrete issues. ${input.slice(7)}`
          : mode === "plan"
            ? `Make a plan. ${input.slice(5)}`
            : input;
      const next: ModelMessage[] = [
        ...messages,
        { role: "user", content: prompt },
      ];
      const controller = new AbortController();
      const abort = () => {
        controller.abort();
        console.log(c.dim("\nCancelling…"));
      };
      closeReader();
      process.on("SIGINT", abort);
      try {
        const result = await runAgent({
          root,
          model,
          messages: next,
          mode,
          approve,
          signal: controller.signal,
          onText: (t) => process.stdout.write(t),
          onTool: (name) =>
            console.log(c.dim(`\n  ${name.replaceAll("_", " ")}…`)),
        });
        messages = result.messages;
        console.log(
          c.dim(
            `\n\n${result.usage.totalTokens ?? "?"} tokens · conversation saved locally\n`,
          ),
        );
        await savePrivate(historyFile(root), { root, messages });
        await showSponsor(config.server);
      } catch (e) {
        console.error(
          c.red(
            "\n" +
              (controller.signal.aborted
                ? "Request cancelled."
                : redactSecrets(
                    e instanceof Error ? e.message : "Request failed.",
                  )),
          ),
        );
        if (opts.prompt) {
          process.exitCode = 1;
          break;
        }
      } finally {
        process.off("SIGINT", abort);
      }
      if (opts.prompt) break;
    }
  });
program
  .parseAsync()
  .catch((e) => {
    console.error(
      c.red(redactSecrets(e instanceof Error ? e.message : "Freecoda failed.")),
    );
    process.exitCode = 1;
  })
  .finally(closeReader);
