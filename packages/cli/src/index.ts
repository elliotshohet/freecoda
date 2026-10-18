#!/usr/bin/env node
import { Command } from "commander";
import { realpath } from "node:fs/promises";
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
import { loadConfig, saveConfig, type ThemePreference } from "./config";
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
import { permissionPreset } from "./permissions";
import { showSponsor } from "./ads";
import {
  loadConversation,
  saveConversation,
  newConversation,
  listConversations,
  clearConversations,
  conversationScope,
  type ConversationMode,
} from "./threads";
import {
  CLI_VERSION,
  checkUpdate,
  newerVersion,
  installCommand,
  installUpdate,
} from "./update";
const program = new Command()
  .name("freecoda")
  .description("Your conversational assistant and local coding workspace.")
  .version(CLI_VERSION);
program
  .command("update")
  .description("Check npm for a newer Freecoda CLI")
  .option(
    "--install",
    "Explicitly install the latest stable release globally using npm",
  )
  .action(async (opts) => {
    const latest = await checkUpdate();
    if (!newerVersion(latest)) {
      console.log(`Freecoda ${CLI_VERSION} is up to date (npm: ${latest}).`);
      return;
    }
    console.log(`Freecoda ${latest} is available (installed: ${CLI_VERSION}).`);
    console.log(installCommand(latest));
    if (opts.install) {
      await installUpdate(latest);
      console.log(
        "Updated. Start a new Freecoda session to use the new version.",
      );
    }
  });
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
  .description(
    "Delete saved chat and coding conversations for the current directory",
  )
  .action(async () => {
    const root = await realpath(program.opts().cwd || process.cwd());
    await clearConversations(root);
    await clearConversations(conversationScope(root, "chat"));
    console.log(
      "All local chat and coding conversations deleted for this directory.",
    );
  });
program
  .option("--cwd <path>", "Workspace directory")
  .option("--resume", "Resume the latest conversation in the selected mode")
  .option("--mode <mode>", "Initial mode: chat, build, plan, or review", "chat")
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
    if (!["chat", "build", "plan", "review"].includes(opts.mode))
      throw Error("Choose --mode chat, build, plan, or review.");
    let defaultMode: ConversationMode = opts.mode;
    async function ensureRepositoryTrust() {
      if (config.trustedRoots.includes(root)) return;
      console.log(
        `\nWorkspace: ${root}\nCoding modes read non-ignored project files and repository instructions. Relevant context goes to your selected provider. Your permission preset controls edits and commands. Commands are not an OS sandbox.\n`,
      );
      if (
        !process.stdin.isTTY ||
        (await ask("Trust this repository? [y/N] ")).toLowerCase() !== "y"
      )
        throw Error("Repository not trusted. No project files were read.");
      config.trustedRoots.push(root);
      await saveConfig(config);
    }
    if (defaultMode !== "chat") await ensureRepositoryTrust();
    let scope = conversationScope(root, defaultMode);
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
    const latest = await loadConversation(scope);
    // Preserve legacy single-session history before the latest-task pointer changes.
    if (latest.messages.length) await saveConversation(latest);
    let conversation = opts.resume ? latest : newConversation(scope);
    let messages: ModelMessage[] = conversation.messages;
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
    let sessionOpen = true;
    if (screen)
      void checkUpdate()
        .then((latest) => {
          if (sessionOpen && newerVersion(latest))
            notice(
              `Freecoda ${latest} is available. Exit this session, then run freecoda update --install.`,
            );
        })
        .catch(() => {});
    if (screen) void showSponsor(config.server, (ad) => screen.showSponsor(ad));
    if (screen)
      screen.onOpenSponsor = (href) => {
        void open(href).catch(() =>
          notice("Could not open the sponsor link. Visit " + href),
        );
      };
    const permissions = approvals();
    screen?.setMode(permissions.effectiveMode(defaultMode));
    async function switchMode(next: ConversationMode) {
      if (next !== "chat") await ensureRepositoryTrust();
      const nextScope = conversationScope(root, next);
      if (nextScope !== scope) {
        await saveConversation({ ...conversation, messages });
        scope = nextScope;
        conversation = newConversation(scope);
        messages = [];
        screen?.clear();
        notice(
          "Started a separate conversation. General chat and coding history never mix; /resume lists this mode’s saved conversations.",
        );
      }
      defaultMode = next;
      screen?.setMode(permissions.effectiveMode(defaultMode));
    }
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
        if (input === "/permissions" || input.startsWith("/permissions ")) {
          let selected = input.slice(12).trim();
          if (!selected && screen)
            selected = await screen.choosePermissions(permissions.preset);
          else if (!selected && process.stdin.isTTY)
            selected = await ask(
              "Permissions: 1 Read only / 2 Default / 3 Full access (edits and commands without asking), Enter cancel: ",
            );
          const preset = permissionPreset(selected);
          if (preset) {
            permissions.setPreset(preset);
            screen?.setMode(permissions.effectiveMode(defaultMode));
            notice(
              `Permissions: ${permissions.describe()}. Previous category grants cleared. Session only; coding presets never enable project access or tools in Chat. Plan and Review always stay read-only.`,
            );
          } else if (selected)
            error(
              "Use /permissions read-only, default, full-access, or 1/2/3.",
            );
          else
            notice(
              `Permissions unchanged: ${permissions.describe()}. Use /permissions read-only, default, or full-access.`,
            );
          if (opts.prompt) break;
          continue;
        }
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
        if (input === "/update" || input.startsWith("/update ")) {
          notice(
            "Exit this session, then run freecoda update to check or freecoda update --install to install. Updates never replace the CLI during an active session.",
          );
          if (opts.prompt) break;
          continue;
        }
        if (input === "/help") {
          notice(
            "/plan <task>  Read-only plan\n/review <task>  Read-only code review\n/mode chat|build|plan|review  Set the default mode\n/model [id]  List or select models\n/permissions [read-only|default|full-access]  Session tool permissions\n/theme auto|dark|light  Save the terminal palette\n/update  Check/install instructions (exit session first)\n/usage  Hosted allowance and reset time\n/status  Current workspace and provider\n/new  Start a new saved task\n/resume [number or id]  List or reopen saved tasks\n/clear  Clear the visible transcript\n/exit  Exit Freecoda\n\nEnter sends. Ctrl+J adds a newline. Paste never submits automatically. Up/Down recalls input. PageUp/PageDown scrolls. Escape or Ctrl+C cancels a running request. Approval: y once, s category for this session, n decline.",
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
          conversation = await saveConversation({ ...conversation, messages });
          conversation = newConversation(scope);
          messages = [];
          await saveConversation(conversation);
          screen?.clear();
          notice("New task. /resume opens earlier tasks in this project.");
          if (opts.prompt) break;
          continue;
        }
        if (input === "/resume" || input.startsWith("/resume ")) {
          try {
            const saved = await listConversations(scope);
            const selected = input.slice(7).trim();
            if (!selected)
              notice(
                saved.length
                  ? saved
                      .map(
                        (item, index) =>
                          `${index + 1}. ${item.title}\n   /resume ${item.id}`,
                      )
                      .join("\n")
                  : "No saved tasks in this project yet.",
              );
            else {
              const item = /^\d+$/.test(selected)
                ? saved[Number(selected) - 1]
                : saved.find((item) => item.id === selected);
              if (!item)
                error(
                  "Task not found. Use /resume to list tasks in this project.",
                );
              else {
                await saveConversation({ ...conversation, messages });
                conversation = await loadConversation(scope, item.id);
                messages = conversation.messages;
                await saveConversation(conversation);
                screen?.clear();
                for (const message of messages
                  .filter(
                    (item) => item.role === "user" || item.role === "assistant",
                  )
                  .slice(-10)) {
                  const text =
                    typeof message.content === "string"
                      ? message.content
                      : message.content
                          .filter((part) => part.type === "text")
                          .map((part) => part.text)
                          .join("");
                  if (text)
                    screen
                      ? screen.append(
                          message.role === "user" ? "you" : "freecoda",
                          text.slice(-6000),
                        )
                      : notice(text.slice(-6000));
                }
                notice("Resumed task: " + conversation.title);
              }
            }
          } catch (e) {
            error(
              redactSecrets(
                e instanceof Error ? e.message : "Could not open local tasks.",
              ),
            );
          }
          if (opts.prompt) break;
          continue;
        }
        if (input === "/status") {
          notice(
            `Workspace: ${root}\nModel: ${modelLabel}\nMode: ${defaultMode} (effective: ${permissions.effectiveMode(defaultMode)})\nAccess: ${defaultMode === "chat" ? "Chat has no project access or tools. Coding preset: " : "Coding preset: "}${permissions.describe()}\nTheme: ${config.theme}\nConversation: ${messages.length} messages saved locally\nPlan: free forever, supported by sponsors. Hosted fair-use limits apply.`,
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
        if (input === "/mode" || input.startsWith("/mode ")) {
          const selected = input.slice(6).trim();
          if (!["chat", "build", "plan", "review"].includes(selected))
            error("Use /mode chat, build, plan, or review.");
          else {
            try {
              await switchMode(selected as ConversationMode);
              notice("Default mode: " + defaultMode);
            } catch (e) {
              error(e instanceof Error ? e.message : "Could not change mode.");
            }
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
        if (conversationScope(root, mode) !== scope) {
          try {
            await switchMode(mode);
          } catch (e) {
            error(
              e instanceof Error ? e.message : "Repository trust required.",
            );
            if (opts.prompt) {
              process.exitCode = 1;
              break;
            }
            continue;
          }
        } else if (mode !== "chat") {
          try {
            await ensureRepositoryTrust();
          } catch (e) {
            error(
              e instanceof Error ? e.message : "Repository trust required.",
            );
            if (opts.prompt) {
              process.exitCode = 1;
              break;
            }
            continue;
          }
        }
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
        screen?.setMode(permissions.effectiveMode(mode));
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
            mode: permissions.effectiveMode(mode),
            approve: permissions.approve,
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
          conversation = await saveConversation({ ...conversation, messages });
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
            screen.setMode(permissions.effectiveMode(defaultMode));
          }
        }
        if (opts.prompt) break;
      }
    } finally {
      sessionOpen = false;
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
