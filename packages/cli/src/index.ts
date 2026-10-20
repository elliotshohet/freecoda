#!/usr/bin/env node
import { Command, Option } from "commander";
import { createVoiceTurnGuard } from "./voice-turn";
import { codexUnsupportedCommand } from "@freecoda/contracts";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { platform, arch } from "node:os";
import c from "picocolors";
import open from "open";
import {
  startVoiceBridge,
  type VoiceBridge,
  runAgent,
  directModel,
  hostedModel,
  validateBaseURL,
  redactSecrets,
  loadExtensionRegistry,
  saveExtensionRegistry,
  installSkill,
  fetchPluginManifest,
  installPlugin,
  removePlugin,
  installMcpServer,
  setExtensionEnabled,
  removeExtension,
  publicExtensions,
} from "@freecoda/core";
import type { ModelMessage, LanguageModel } from "ai";
import {
  loadConfig,
  saveConfig,
  stateDir,
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
  automaticUpdate,
} from "./update";
import { AccountThreadSync } from "./cloud-threads";
import { createHash } from "node:crypto";
import { registerRepoCommands } from "./repos";
import { prepareInteractiveUpdate } from "./interactive-update";
import { extensionInventory, extensionRequest, showExtension } from "./extension-commands";
import { copyAssistantText, latestAssistantText, workspaceDiff } from "./native-commands";
import { SessionTools } from "./session-tools";
import { approvedFreeModels } from "./models";
const program = new Command()
  .name("freecoda")
  .description("Your conversational assistant and local coding workspace.")
  .version(CLI_VERSION);
registerRepoCommands(program);
program
  .command("update")
  .description("Check GitHub Releases for a newer Freecoda CLI")
  .option(
    "--install",
    "Explicitly install the latest stable release globally using npm",
  )
  .action(async (opts) => {
    const latest = await checkUpdate();
    if (!newerVersion(latest)) {
      console.log(`Freecoda ${CLI_VERSION} is up to date (release: ${latest}).`);
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
const extensionFile = () => path.join(stateDir(), "extensions.json");
const extensionCommand = program
  .command("extensions")
  .description(
    "Install and manage MCP tools and SKILL.md skills (local client only)",
  );
extensionCommand
  .command("list")
  .action(async () =>
    console.log(
      JSON.stringify(
        publicExtensions(await loadExtensionRegistry(extensionFile())),
        null,
        2,
      ),
    ),
  );
extensionCommand.command("show <id>").description("Read an installed skill or MCP connection").action(async (id: string) => {
  console.log(safeTerminalText(showExtension(await loadExtensionRegistry(extensionFile()), id)));
});
extensionCommand
  .command("add-skill <source>")
  .description(
    "Install and enable a local SKILL.md/directory or HTTPS SKILL.md URL; no install script is run",
  )
  .option("--name <name>")
  .action(async (source, opts) => {
    const registry = await installSkill(
      await loadExtensionRegistry(extensionFile()),
      { source, name: opts.name, allowLocal: true },
    );
    await saveExtensionRegistry(extensionFile(), registry);
    console.log(
      "Skill installed and enabled. Its guidance applies to coding modes, not general Chat.",
    );
  });
extensionCommand
  .command("add-mcp <name> <url>")
  .description(
    "Install and enable an HTTP MCP server; external calls require command approval",
  )
  .action(async (name, url) => {
    const registry = installMcpServer(
      await loadExtensionRegistry(extensionFile()),
      { name, url },
    );
    await saveExtensionRegistry(extensionFile(), registry);
    console.log(
      "MCP server installed and enabled. External tools run only in Agent mode after command-category approval; session grants apply to all commands and external tools.",
    );
  });
for (const operation of ["enable", "disable", "remove"] as const)
  extensionCommand.command(`${operation} <id>`).action(async (id) => {
    const registry = await loadExtensionRegistry(extensionFile());
    await saveExtensionRegistry(
      extensionFile(),
      operation === "remove"
        ? removeExtension(registry, id)
        : setExtensionEnabled(registry, id, operation === "enable"),
    );
    console.log(`Extension ${operation}d.`);
  });
const pluginCommand = program.command("plugins").description("Review and install plugin manifests containing MCP connections and skills");
pluginCommand.command("list").action(async () => console.log(JSON.stringify((await loadExtensionRegistry(extensionFile())).plugins || [], null, 2)));
pluginCommand.command("add <url>").description("Review a bounded HTTPS JSON plugin manifest before explicitly confirming installation").action(async (url: string) => {
  const manifest = await fetchPluginManifest(url, { allowLocal: true });
  console.log(safeTerminalText(JSON.stringify(manifest, null, 2)));
  console.log("This installs local skill guidance and MCP connections. No scripts run and no execution permissions are granted.");
  if (await ask("Type install to approve this plugin bundle, or Enter to cancel: ") !== "install") { console.log("Installation cancelled."); return; }
  const registry = await installPlugin(await loadExtensionRegistry(extensionFile()), { manifest, source: url, allowLocal: true });
  await saveExtensionRegistry(extensionFile(), registry);
  console.log("Plugin installed locally. Existing trust and execution approvals still apply.");
});
pluginCommand.command("remove <id>").action(async (id: string) => {
  await saveExtensionRegistry(extensionFile(), removePlugin(await loadExtensionRegistry(extensionFile()), id));
  console.log("Plugin and its bundled extensions removed.");
});
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
    const historyConfig = await loadConfig();
    const sync = await AccountThreadSync.open(historyConfig);
    if (sync) {
      await sync.clear(root, "chat");
      await sync.clear(root, "build");
    }
    await clearConversations(root);
    await clearConversations(conversationScope(root, "chat"));
    console.log(
      "Chat and coding copies for this directory deleted. Account deletions sync when connected.",
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
  .addOption(new Option("--model <id>").hideHelp())
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
    const accountSync = await AccountThreadSync.open(config);
    const scopeFor = (mode: ConversationMode) =>
      accountSync
        ? accountSync.scope(root, mode)
        : config.token
          ? `unverified-account:${createHash("sha256")
              .update(config.server + config.token)
              .digest("hex")}:${mode === "chat" ? "chat" : "coding"}:${root}`
          : conversationScope(root, mode);
    let scope = scopeFor(defaultMode);
    const persistConversation = (
      value: Parameters<typeof saveConversation>[0],
    ) =>
      accountSync
        ? accountSync.save(value, defaultMode)
        : saveConversation(value);
    let model: LanguageModel | undefined;
    let modelLabel = "";
    let modelId = "";
    let modelPolicy = "";
    async function selectModel(requested?: string) {
      if (config.provider) {
        const p = config.provider;
        modelId = requested || p.model;
        model = directModel(
          p.baseURL,
          modelId,
          process.env.FREECODA_PROVIDER_KEY || p.apiKey || "",
        );
        modelLabel = "Direct connection";
        modelPolicy =
          "Direct provider: requests bypass Freecoda. Your provider’s policies and charges apply.";
        return;
      }
      if (!config.token)
        throw new Error(
          "Connect your account with freecoda login, or configure a direct provider with freecoda provider configure.",
        );
      const catalog = await api("models");
      catalog.models = approvedFreeModels(catalog.models ?? []);
      if (!catalog.models?.length)
        throw new Error(
          "The hosted AI service is unavailable. Your account can remain connected; try again later or configure your own provider.",
        );
      const chosen = requested
        ? catalog.models.find((item: { id: string }) => item.id === requested)
        : catalog.models[0];
      if (!chosen)
        throw new Error(
          "The configured AI service is unavailable. Check your connection configuration or try again later.",
        );
      modelId = chosen.id;
      model = hostedModel(config.server, chosen.id, config.token);
      modelLabel = "Hosted connection";
      modelPolicy = chosen.allowPromptTraining
        ? "Hosted provider may retain prompts, source excerpts and responses and use them for training. Avoid sensitive material. Free fair-use limits apply."
        : "Hosted prompt training is disallowed. Provider retention may apply. Free fair-use limits apply.";
    }
    await selectModel(opts.model);
    let latest = await loadConversation(scope);
    if (opts.resume && accountSync && !latest.messages.length) {
      const saved = await accountSync.list(root, defaultMode);
      if (saved[0])
        latest = await accountSync.load(root, defaultMode, saved[0].id);
    }
    // Preserve legacy single-session history before the latest-task pointer changes.
    if (latest.messages.length) await persistConversation(latest);
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
    const error = (text: string) => {
      const detail = (modelId ? text.split(modelId).join("the AI service") : text)
        .replace(/reflection\/beam(?:-free|-2)?|beam free|reflection/gi, "the AI service");
      if (screen) screen.append("error", detail);
      else console.error(c.red(safeTerminalText(detail)));
    };
    if (!screen) {
      console.log(
        c.bold(c.magenta("\n  freecoda")) + c.dim("  Your next big thing.\n"),
      );
      notice(modelPolicy);
    } else screen.append("notice", modelPolicy);
    if (accountSync)
      notice(
        "Conversation history syncs to your account across clients. Local copies remain available offline; /resume lists this mode’s account conversations.",
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
      notice(
        "Resumed the conversation in this workspace. Coding tasks use the currently trusted folder; Chat remains tool-free.",
      );
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
    const sessionTools = new SessionTools();
    const captureTurn = () => ({ model: model!, modelLabel, mode: defaultMode, disabledTools: [...sessionTools.disabled] });
    if (screen) screen.captureTurn = captureTurn;
    screen?.setMode(permissions.effectiveMode(defaultMode));
    async function switchMode(next: ConversationMode) {
      if (next !== "chat") await ensureRepositoryTrust();
      const nextScope = scopeFor(next);
      if (nextScope !== scope) {
        await voice?.close();
        await persistConversation({ ...conversation, messages });
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
    let voice: VoiceBridge | undefined;
    let voiceTurn: string | undefined;
    let voiceTurnId: string | undefined;
    let voiceGuard: ReturnType<typeof createVoiceTurnGuard> | undefined;
    async function openVoice() {
      if (!screen || opts.prompt) throw Error("Voice needs the interactive full-screen CLI. Run freecoda without --plain or --prompt.");
      if (!voice) {
        const voiceScope = scope, voiceConversation = conversation.id;
        const instance = await startVoiceBridge({
          title: "Freecoda CLI voice",
          onTranscript({ text, mode, turnId }) {
            if (scope !== voiceScope || conversation.id !== voiceConversation) throw Error("The CLI conversation changed. Stop voice and open /voice again.");
            if (mode === "dictation") { screen.insertVoiceDraft(text); notice("Voice dictation added to the composer. Review and send when ready."); }
            else { if (voiceTurn) throw Error("Wait for the current voice response."); voiceTurn = `Voice message:\n${safeTerminalText(text)}`; voiceTurnId = turnId; voiceGuard = createVoiceTurnGuard(); try { screen.submitVoiceTurn(text); } catch (error) { voiceTurn = undefined; voiceTurnId = undefined; voiceGuard?.cancel(); voiceGuard = undefined; throw error; } }
          },
          onControl(action, turnId) { if ((action === "interrupt" || action === "stop") && voiceTurn && (!turnId || turnId === voiceTurnId)) voiceGuard?.cancel(); },
          onClose() { if (voice === instance) { voiceGuard?.cancel(); voice = undefined; /* Keep the cancelled identity until its resolved composer input is consumed. */ } },
        });
        voice = instance;
      }
      await open(voice.url);
      notice("Voice companion opened. Choose Start dictation to edit words here, or Start conversation for automatic conversational turns. Browser/OS speech may process audio online; no microphone audio is sent to Freecoda.");
    }
    let requestedUpdate: string | undefined;
    let explicitUpdateRequested = false;
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
        const inputVoiceGuard = input === voiceTurn ? voiceGuard : undefined;
        if (inputVoiceGuard?.controller.signal.aborted) {
          voiceTurn = undefined; voiceTurnId = undefined; voiceGuard = undefined;
          continue;
        }
        if (["/exit", "/quit"].includes(input)) break;
        if (input === "/voice" || input.startsWith("/voice ")) {
          try {
            const argument = input.slice(6).trim();
            if (argument === "stop") { await voice?.close(); voice = undefined; voiceTurn = undefined; notice("Voice companion stopped."); }
            else if (!argument || ["dictate", "chat"].includes(argument)) await openVoice();
            else throw Error("Use /voice, /voice chat, or /voice stop. Microphone starts only after you choose a mode in the browser.");
          } catch (e) { error(e instanceof Error ? e.message : "Voice could not start."); }
          if (opts.prompt) break;
          continue;
        }
        if (input === "/queue" || input.startsWith("/queue ")) {
          if (!screen) notice("Queued input is available in the full-screen interface. Plain mode sends one turn at a time.");
          else {
            try {
              const args = input.slice(6).trim().split(/\s+/).filter(Boolean);
              if (args[0] === "resume" && args.length === 1) screen.queue.paused = false;
              else if (args[0] === "remove" && args.length === 2) screen.queue.remove(args[1]!);
              else if (args.length) throw Error("Use /queue, /queue resume, or /queue remove <id>.");
              notice(`${screen.queue.paused ? "Paused" : "Ready"} · ${screen.queue.items.length} queued\n` + screen.queue.items.map((item) => { const context = item.context as ReturnType<typeof captureTurn> | undefined; return `${item.id.slice(0, 8)} · ${context?.mode ?? defaultMode} · ${item.input.slice(0, 160)}`; }).join("\n") + "\n/queue resume retries queued turns; /queue remove <id> discards one. Nothing runs while paused.");
            } catch (e) { error(e instanceof Error ? e.message : "Could not change queue."); }
          }
          if (opts.prompt) break;
          continue;
        }
        if (input === "/mcp" || input.startsWith("/mcp ") || input === "/tools" || input.startsWith("/tools ")) {
          try {
            const registry = await loadExtensionRegistry(extensionFile());
            if (input === "/mcp") notice(safeTerminalText(extensionInventory(registry, "", "mcp")));
            else if (input.startsWith("/mcp")) {
              const result = await sessionTools.mcp(input.slice(4), registry);
              if (result.registry !== registry) await saveExtensionRegistry(extensionFile(), result.registry);
              notice(result.message);
            } else {
              const args = input.slice(6).trim().split(/\s+/).filter(Boolean);
              if (args.length) {
                if (args.length !== 2 || !["enable", "disable"].includes(args[0]!)) throw Error("Use /tools or /tools enable|disable <name>.");
                sessionTools.select(args[1]!, args[0] === "enable", registry);
              }
              notice(sessionTools.names(registry).map((name) => `${sessionTools.disabled.has(name) ? "off" : "on "} ${name}`).join("\n") + "\nSelections apply to following turns in this session. Mode and permissions still restrict availability; Chat has no tools. Use /mcp discover <server-id> to list actual external tools.");
            }
          } catch (e) { error(redactSecrets(e instanceof Error ? e.message : "Could not update tools.")); }
          if (opts.prompt) break;
          continue;
        }
        if (input === "/plugins" || input.startsWith("/plugins ")) {
          try {
            const argument = input.slice(8).trim();
            const registry = await loadExtensionRegistry(extensionFile());
            if (!argument) notice(safeTerminalText(extensionInventory(registry, "", "plugins")));
            else if (argument.startsWith("install ")) {
              if (opts.prompt || !process.stdin.isTTY) throw new Error("Plugin installation requires interactive review.");
              const source = argument.slice(8).trim();
              const manifest = await fetchPluginManifest(source, { allowLocal: true });
              notice(safeTerminalText(JSON.stringify(manifest, null, 2)) + "\nInstalls local skill guidance and MCP connections. No scripts run and no execution permissions are granted.");
              if (await ask("Type install to approve this bundle, or Enter to cancel: ") === "install") {
                await saveExtensionRegistry(extensionFile(), await installPlugin(registry, { manifest, source, allowLocal: true }));
                notice("Plugin installed locally. Existing trust and execution approvals still apply.");
              } else notice("Installation cancelled.");
            } else throw new Error("Use /plugins or /plugins install <manifest URL>.");
          } catch (e) { error(redactSecrets(e instanceof Error ? e.message : "Could not manage plugins.")); }
          if (opts.prompt) break;
          continue;
        }
        let extensionAction;
        try { extensionAction = extensionRequest(input); }
        catch (e) { error(e instanceof Error ? e.message : "Invalid extension command."); if (opts.prompt) break; continue; }
        if (extensionAction) {
          try {
            const registry = await loadExtensionRegistry(extensionFile());
            if (extensionAction.action === "show") notice(safeTerminalText(showExtension(registry, extensionAction.id)));
            else if (extensionAction.action === "list") {
              notice(safeTerminalText(extensionInventory(registry, extensionAction.query)));
            } else {
              if (opts.prompt || !process.stdin.isTTY) throw new Error("Installation requires an interactive session, or use the explicit freecoda extensions add-skill/add-mcp command.");
              const detail = extensionAction.action === "install-skill" ? `skill from ${extensionAction.source}` : `MCP connection ${extensionAction.name} at ${extensionAction.url}`;
              notice(safeTerminalText(`Install and enable local ${detail}? Third-party guidance and tools are untrusted. No installation scripts run; existing execution approvals still apply.`));
              if ((await ask("Type install to confirm, or Enter to cancel: ")) === "install") {
                const next = extensionAction.action === "install-skill"
                  ? await installSkill(registry, { source: extensionAction.source, allowLocal: true })
                  : installMcpServer(registry, { name: extensionAction.name, url: extensionAction.url });
                await saveExtensionRegistry(extensionFile(), next);
                notice("Installed locally. Use /extensions to browse. Coding tools still require project trust and execution permissions.");
              } else notice("Installation cancelled.");
            }
          } catch (e) { error(redactSecrets(e instanceof Error ? e.message : "Could not manage extensions.")); }
          if (opts.prompt) break;
          continue;
        }
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
          explicitUpdateRequested = true;
          try {
            const result = await prepareInteractiveUpdate({
              interactive: !opts.prompt && Boolean(process.stdin.isTTY),
              queued: screen?.queue.items.length || 0,
              confirm: async version => (await ask(`Install verified CLI ${version} after saving and closing this session? Type update to confirm: `)) === "update",
            });
            notice(result.message);
            if (result.version) {
              await persistConversation({ ...conversation, messages });
              requestedUpdate = result.version;
              break;
            }
          } catch (e) { error(redactSecrets(e instanceof Error ? e.message : "Update failed; nothing was installed.")); }
          if (opts.prompt) break;
          continue;
        }
        if (input === "/help") {
          notice(
            "/plan <task>  Read-only plan\n/review <task>  Read-only code review\n/mode chat|build|plan|review  Set the default mode\n/mcp [enable|disable|discover <id>]  Manage connections\n/tools [enable|disable <name>]  Select next-turn tools\n/extensions [search]  Browse installed tools and skills\n/skills show <id>  Read installed skill instructions\n/install skill <source> | mcp <name> <url>  Review a local installation\n/queue [resume|remove <id>]  Review paused or queued turns\n/permissions [read-only|default|full-access]  Session tool permissions\n/theme auto|dark|light  Save the terminal palette\n/update  Check and install after saving and closing this session\n/voice [chat|stop]  Browser dictation or live conversation\n/usage  Hosted allowance and reset time\n/status  Current workspace and provider\n/new  Start a new saved task\n/resume [number or id]  List or reopen saved tasks\n/clear  Start a fresh chat; preserve saved history\n/copy  Copy the latest assistant response (macOS)\n/diff  Show tracked diff and untracked paths (trusted workspace)\n/pwd or /cwd  Show selected directory\n/exit  Exit Freecoda\n\nEnter sends. Ctrl+J adds a newline. Paste never submits automatically. Up/Down recalls input. PageUp/PageDown scrolls. Escape or Ctrl+C cancels a running request. Approval: y once, s category for this session, n decline.",
          );
          if (opts.prompt) break;
          continue;
        }
        if (input === "/new" || input === "/clear") {
          await voice?.close();
          conversation = await persistConversation({
            ...conversation,
            messages,
          });
          conversation = newConversation(scope);
          messages = [];
          await persistConversation(conversation);
          screen?.clear();
          notice("New chat. Previous history is saved; /resume opens earlier chats.");
          if (opts.prompt) break;
          continue;
        }
        if (input === "/pwd" || input === "/cwd") {
          notice(safeTerminalText(`Selected directory: ${root}\n${defaultMode === "chat" ? "Chat has no repository access." : "Repository access follows workspace trust and permissions."}`));
          if (opts.prompt) break;
          continue;
        }
        if (input === "/copy") {
          try {
            const text = latestAssistantText(messages);
            if (!text) throw Error("No completed assistant response to copy in this chat.");
            await copyAssistantText(text);
            notice("Copied the latest assistant response.");
          } catch (e) { error(e instanceof Error ? e.message : "Could not copy the response."); }
          if (opts.prompt) break;
          continue;
        }
        if (input === "/diff") {
          try {
            if (defaultMode === "chat") throw Error("/diff requires a coding mode and a trusted workspace. Use /build or /mode review first.");
            await ensureRepositoryTrust();
            notice(safeTerminalText(await workspaceDiff(root)));
          } catch (e) { error(redactSecrets(e instanceof Error ? e.message : "Could not read repository changes.")); }
          if (opts.prompt) break;
          continue;
        }
        if (input === "/resume" || input.startsWith("/resume ")) {
          try {
            const saved = accountSync
              ? await accountSync.list(root, defaultMode)
              : await listConversations(scope);
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
                await voice?.close();
                await persistConversation({ ...conversation, messages });
                conversation = accountSync
                  ? await accountSync.load(root, defaultMode, item.id)
                  : await loadConversation(scope, item.id);
                messages = conversation.messages;
                await persistConversation(conversation);
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
            `Workspace: ${root}\nData policy: ${modelPolicy}\nMode: ${defaultMode} (effective: ${permissions.effectiveMode(defaultMode)})\nAccess: ${defaultMode === "chat" ? "Chat has no project access or tools. Coding preset: " : "Coding preset: "}${permissions.describe()}\nTheme: ${config.theme}\nConversation: ${messages.length} messages saved locally\nPlan: free forever, supported by sponsors. Hosted fair-use limits apply.`,
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
        if (input === "/chat" || input === "/build" || input === "/mode" || input.startsWith("/mode ")) {
          const selected = input === "/chat" ? "chat" : input === "/build" ? "build" : input.slice(6).trim();
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
          error(codexUnsupportedCommand(input.trim().split(/\s+/)[0]!) || "Unknown command. Use /help to see available commands.");
          if (opts.prompt) break;
          continue;
        }
        const captured = screen?.dequeuedTurn?.context as ReturnType<typeof captureTurn> | undefined;
        const activeTurn = screen?.dequeuedTurn;
        const mode = /^\/plan(?:\s|$)/.test(input)
          ? "plan"
          : /^\/review(?:\s|$)/.test(input)
            ? "review"
            : captured?.mode ?? defaultMode;
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
        // Trust and conversation selection can await. Stop must win before any
        // visible turn dispatch or model work, even if no screen cancel hook existed.
        if (inputVoiceGuard?.controller.signal.aborted) {
          voiceTurn = undefined; voiceTurnId = undefined; voiceGuard = undefined;
          continue;
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
        const controller = inputVoiceGuard?.controller ?? new AbortController();
        const abort = () => {
          if (controller.signal.aborted) return;
          controller.abort();
          notice("Cancelling the current request…");
        };
        screen && (screen.onCancel = abort);
        closeReader();
        process.on("SIGINT", abort);
        let responseCompleted = false;
        try {
          const extensions = await loadExtensionRegistry(extensionFile());
          inputVoiceGuard?.assertActive();
          controller.signal.throwIfAborted();
          const result = await runAgent({
            root,
            disabledTools: [...new Set([...(captured?.disabledTools ?? []), ...sessionTools.disabled])],
            extensions,
            model: captured?.model ?? model!,
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
          controller.signal.throwIfAborted();
          responseCompleted = true;
          if (voiceTurn === input) { voice?.publish({ type: "assistant", text: result.text, turnId: voiceTurnId }); voiceTurn = undefined; voiceTurnId = undefined; }
          messages = result.messages;
          conversation = await persistConversation({
            ...conversation,
            messages,
          });
          messages = conversation.messages;
          notice(
            `${result.usage.totalTokens ?? "?"} tokens · conversation saved locally (offline copy)${accountSync ? (accountSync.hasPending() ? "; account sync pending" : "; synced to your account") : config.token ? "; account sync unavailable — retry after reconnecting" : "; sign in to sync across devices"}`,
          );
          await showSponsor(
            config.server,
            screen ? (ad) => screen.showSponsor(ad) : undefined,
          );
        } catch (e) {
          if (voiceTurn === input) { voice?.publish({ type: "stop", text: controller.signal.aborted ? "Voice turn interrupted." : "Voice turn failed. Review the CLI error before restarting.", turnId: voiceTurnId }); voiceTurn = undefined; voiceTurnId = undefined; }
          if (screen) {
            screen.queue.paused = true;
            if (!responseCompleted) screen.queue.items.unshift(activeTurn ?? { id: crypto.randomUUID(), input, context: captureTurn() });
            notice(responseCompleted
              ? "Response completed but saving failed. Queue paused; the completed request will not be sent again. Use /queue to review following turns."
              : "Queue paused; the interrupted turn is retained. Use /queue to review, /queue resume to retry, or /queue remove <id> to discard.");
          }
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
      await voice?.close();
      screen?.close();
      closeReader();
      closeTerminal();
      if (requestedUpdate) {
        await installUpdate(requestedUpdate);
        console.log(`Updated to Freecoda ${requestedUpdate}. Start freecoda again to continue.`);
      } else if (!explicitUpdateRequested && !opts.prompt && process.stdin.isTTY) await automaticUpdate(console.log);
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
