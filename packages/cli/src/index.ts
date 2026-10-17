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
import type { ModelMessage, LanguageModel } from "ai";
import {
  loadConfig,
  saveConfig,
  historyFile,
  savePrivate,
  type ThemePreference,
} from "./config";
import {
  ask,
  secret,
  approvals,
  closeReader,
  closeTerminal,
  TerminalScreen,
  TerminalExit,
  safeTerminalText,
  resolveTerminalTheme,
} from "./ui";
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
    const verification = new URL(start.verificationUri);
    if (
      verification.origin !== new URL(config.server).origin ||
      verification.username ||
      verification.password
    )
      throw new Error(
        "The verification page must belong to your configured Freecoda server.",
      );
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
  .option("--resume", "Resume the latest local conversation")
  .option(
    "--theme <theme>",
    "Terminal palette: auto, dark, or light (saved locally)",
  )
  .option(
    "--plain",
    "Use a scrolling transcript instead of the full-screen interface",
  )
  .option(
    "--model <id>",
    "Select an approved hosted model or a direct provider model",
  )
  .option("-p, --prompt <text>", "Run one task with a plain transcript")
  .action(async (opts) => {
    const root = await realpath(opts.cwd || process.cwd());
    const config = await loadConfig();
    if (opts.theme) {
      if (!["auto", "dark", "light"].includes(opts.theme))
        throw new Error("Choose --theme auto, dark, or light.");
      config.theme = opts.theme;
      await saveConfig(config);
    }
    if (!config.trustedRoots.includes(root)) {
      console.log(
        `\nWorkspace: ${root}\nFreecoda reads non-ignored files and repository instructions. Relevant context goes to your chosen AI provider. Writes and shell commands require approval. Shell commands are not an OS sandbox.\n`,
      );
      if ((await ask("Trust this repository? [y/N] ")).toLowerCase() !== "y")
        throw new Error("Repository not trusted. No project files were read.");
      config.trustedRoots.push(root);
      await saveConfig(config);
    }
    let model: LanguageModel | undefined;
    let modelLabel = "";
    let modelId = "";
    async function selectModel(requested?: string) {
      if (config.provider) {
        const p = config.provider;
        modelId = requested || p.model;
        model = directModel(
          p.baseURL,
          modelId,
          process.env.FREECODA_PROVIDER_KEY || p.apiKey || "",
        );
        modelLabel = `${modelId} · direct ${new URL(p.baseURL).host}`;
        return;
      }
      if (!config.token)
        throw new Error(
          "Connect your account with freecoda login, or configure a direct provider with freecoda provider configure.",
        );
      const catalog = await api("models");
      if (!catalog.models?.length)
        throw new Error(
          "Hosted models are unavailable. Your account can remain connected; try again later or configure your own provider.",
        );
      const chosen = requested
        ? catalog.models.find((item: { id: string }) => item.id === requested)
        : catalog.models[0];
      if (!chosen)
        throw new Error(
          "That hosted model is unavailable. Use /model to see the approved catalog.",
        );
      modelId = chosen.id;
      model = hostedModel(config.server, chosen.id, config.token);
      modelLabel = `${chosen.id} · hosted via ${chosen.provider}`;
    }
    await selectModel(opts.model);
    let messages: ModelMessage[] = [];
    if (opts.resume) {
      try {
        const saved = JSON.parse(await readFile(historyFile(root), "utf8"));
        if (saved.root === root && Array.isArray(saved.messages))
          messages = saved.messages;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error("Could not resume the local conversation.");
      }
    }
    const screen =
      !opts.prompt && !opts.plain && TerminalScreen.available()
        ? new TerminalScreen(root, modelLabel, config.theme).start()
        : undefined;
    const notice = (text: string) =>
      screen
        ? screen.append("notice", text)
        : console.log(c.dim(safeTerminalText(text)));
    const error = (text: string) =>
      screen
        ? screen.append("error", text)
        : console.error(c.red(safeTerminalText(text)));
    if (!screen) {
      console.log(
        c.bold(c.magenta("\n  freecoda")) + c.dim("  Your next big thing.\n"),
      );
      notice(
        modelLabel +
          "\n" +
          (config.provider
            ? "Your provider’s policies and charges apply."
            : "Hosted prompt training is disallowed. Free fair-use limits apply."),
      );
    } else if (config.provider)
      screen.append(
        "notice",
        "Direct provider: requests bypass Freecoda. Your provider’s policies and charges apply.",
      );
    if (screen && messages.length) {
      for (const message of messages
        .filter((item) => item.role === "user" || item.role === "assistant")
        .slice(-10)) {
        const text =
          typeof message.content === "string"
            ? message.content
            : message.content
                .map((part) => (part.type === "text" ? part.text : ""))
                .join("");
        if (text)
          screen.append(
            message.role === "user" ? "you" : "freecoda",
            text.slice(-6000),
          );
      }
      notice("Resumed the conversation saved locally for this workspace.");
    }
    if (screen) void showSponsor(config.server, (ad) => screen.showSponsor(ad));
    if (screen)
      screen.onOpenSponsor = (href) => {
        void open(href).catch(() =>
          notice("Could not open the sponsor link. Visit " + href),
        );
      };
    const approve = approvals();
    let defaultMode: "build" | "plan" | "review" = "build";
    try {
      for (;;) {
        let input: string;
        try {
          input =
            opts.prompt ||
            (screen ? await screen.prompt() : await ask(c.magenta("› ")));
        } catch (e) {
          if (e instanceof TerminalExit) break;
          throw e;
        }
        if (!input) continue;
        if (["/exit", "/quit"].includes(input)) break;
        if (input === "/theme" || input.startsWith("/theme ")) {
          const value = input.slice(6).trim();
          if (value && !["auto", "dark", "light"].includes(value))
            error("Use /theme auto, /theme dark, or /theme light.");
          else {
            if (value) {
              config.theme = value as ThemePreference;
              await saveConfig(config);
              screen?.setTheme(config.theme);
            }
            notice(
              `Theme: ${config.theme}${config.theme === "auto" ? " (" + resolveTerminalTheme(config.theme) + ")" : ""}. Terminal background is inherited.`,
            );
          }
          if (opts.prompt) break;
          continue;
        }
        if (input === "/help") {
          notice(
            "/plan <task>  Read-only plan\n/review <task>  Read-only code review\n/mode build|plan|review  Set the default mode\n/model [id]  List or select models\n/theme auto|dark|light  Save the terminal palette\n/usage  Hosted allowance and reset time\n/status  Current workspace and provider\n/new  Clear the model conversation\n/clear  Clear the visible transcript\n/exit  Exit Freecoda\n\nEnter sends. Ctrl+J adds a newline. Paste never submits automatically. Up/Down recalls input. PageUp/PageDown scrolls. Escape or Ctrl+C cancels a running request. Approval: y once, s category for this session, n decline.",
          );
          if (opts.prompt) break;
          continue;
        }
        if (input === "/clear") {
          screen?.clear();
          if (!screen) console.clear();
          if (opts.prompt) break;
          continue;
        }
        if (input === "/new") {
          messages = [];
          await savePrivate(historyFile(root), { root, messages });
          notice("New conversation. Existing project files are unchanged.");
          if (opts.prompt) break;
          continue;
        }
        if (input === "/status") {
          notice(
            `Workspace: ${root}\nModel: ${modelLabel}\nMode: ${defaultMode}\nTheme: ${config.theme}\nConversation: ${messages.length} messages saved locally\nPlan: free forever, supported by sponsors. Hosted fair-use limits apply.`,
          );
          if (opts.prompt) break;
          continue;
        }
        if (input === "/usage") {
          try {
            notice(
              config.provider
                ? "Direct provider usage is billed and tracked by your provider."
                : JSON.stringify(await api("usage"), null, 2),
            );
          } catch (e) {
            error(
              redactSecrets(
                e instanceof Error ? e.message : "Usage is unavailable.",
              ),
            );
          }
          if (opts.prompt) break;
          continue;
        }
        if (input === "/model" || input.startsWith("/model ")) {
          const requested = input.slice(6).trim();
          try {
            if (requested) {
              await selectModel(requested);
              screen?.setModel(modelLabel);
              notice("Selected " + modelLabel);
            } else if (config.provider)
              notice(
                `Current model: ${modelId}. Use /model <exact-provider-model-id> to switch.`,
              );
            else {
              const catalog = await api("models");
              notice(
                catalog.models
                  .map(
                    (item: { id: string; provider: string }) =>
                      `${item.id} · ${item.provider}`,
                  )
                  .join("\n") + "\nUse /model <id> to select.",
              );
            }
          } catch (e) {
            error(
              redactSecrets(
                e instanceof Error ? e.message : "Could not select model.",
              ),
            );
          }
          if (opts.prompt) break;
          continue;
        }
        if (input.startsWith("/mode ")) {
          const selected = input.slice(6).trim();
          if (!["build", "plan", "review"].includes(selected))
            error("Use /mode build, /mode plan, or /mode review.");
          else {
            defaultMode = selected as typeof defaultMode;
            screen?.setMode(defaultMode);
            notice("Default mode: " + defaultMode);
          }
          if (opts.prompt) break;
          continue;
        }
        if (input.startsWith("/") && !/^\/(plan|review)(?:\s|$)/.test(input)) {
          error("Unknown command. Use /help to see available commands.");
          if (opts.prompt) break;
          continue;
        }
        const mode = /^\/plan(?:\s|$)/.test(input)
          ? "plan"
          : /^\/review(?:\s|$)/.test(input)
            ? "review"
            : defaultMode;
        const prompt =
          mode === "review"
            ? `Review the project and report concrete issues. ${input.replace(/^\/review\s*/, "")}`
            : mode === "plan"
              ? `Make a plan. ${input.replace(/^\/plan\s*/, "")}`
              : input;
        const next: ModelMessage[] = [
          ...messages,
          { role: "user", content: prompt },
        ];
        screen?.append("you", input);
        screen?.setMode(mode);
        screen?.setBusy(true, "Working");
        const controller = new AbortController();
        const abort = () => {
          if (controller.signal.aborted) return;
          controller.abort();
          notice("Cancelling the current request…");
        };
        screen && (screen.onCancel = abort);
        closeReader();
        process.on("SIGINT", abort);
        try {
          const result = await runAgent({
            root,
            model: model!,
            messages: next,
            mode,
            approve,
            signal: controller.signal,
            onText: (text) =>
              screen
                ? screen.appendText(text)
                : process.stdout.write(safeTerminalText(text)),
            onTool: (name) => {
              const label = name.replaceAll("_", " ");
              if (screen) {
                screen.append("tool", label + "…");
                screen.setBusy(true, label);
              } else console.log(c.dim("\n  " + label + "…"));
            },
          });
          messages = result.messages;
          await savePrivate(historyFile(root), { root, messages });
          notice(
            `${result.usage.totalTokens ?? "?"} tokens · conversation saved locally`,
          );
          await showSponsor(
            config.server,
            screen ? (ad) => screen.showSponsor(ad) : undefined,
          );
        } catch (e) {
          error(
            controller.signal.aborted
              ? "Request cancelled."
              : redactSecrets(
                  e instanceof Error ? e.message : "Request failed.",
                ),
          );
          if (opts.prompt) {
            process.exitCode = 1;
            break;
          }
        } finally {
          process.off("SIGINT", abort);
          if (screen) {
            screen.onCancel = undefined;
            screen.setBusy(false);
            screen.setMode(defaultMode);
          }
        }
        if (opts.prompt) break;
      }
    } finally {
      screen?.close();
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
  .finally(() => {
    closeReader();
    closeTerminal();
  });
