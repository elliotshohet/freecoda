/** CI-only native runtime smoke. No credentials, workspace, provider, or app test hooks. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = fileURLToPath(new URL("../", import.meta.url));
const requireDesktop = createRequire(
  new URL("../package.json", import.meta.url),
);
const electronBinary = requireDesktop("electron");
const profile = await mkdtemp(join(tmpdir(), "freecoda-runtime-smoke-"));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = Date.now() + 45_000;
let child;
let client;
let debuggingSocket;
let diagnostics = "";

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.externalRequests = [];
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.method === "Network.requestWillBeSent") {
        const url = message.params.request.url;
        if (/^https?:/.test(url)) this.externalRequests.push(url);
      }
      if (!message.id) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Desktop debugging connection closed."));
      }
      this.pending.clear();
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out: ${method}`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, phase = "renderer evaluation") {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }).catch((error) => {
      throw new Error(`${phase}: ${error.message}`, { cause: error });
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result.value;
  }
}

try {
  await readFile(join(desktopRoot, "dist", "main.cjs"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Keep developer Node injection/configuration out of this isolated smoke process.
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  child = spawn(
    electronBinary,
    [
      desktopRoot,
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-domain-reliability",
      "--disable-sync",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let spawnError;
  child.once("error", (error) => {
    spawnError = error;
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      diagnostics = (diagnostics + chunk).slice(-16_384);
    });

  let target;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode)
      throw new Error(
        `Electron exited before its renderer was ready (${child.exitCode ?? child.signalCode}).`,
      );
    try {
      const [portString] = (
        await readFile(join(profile, "DevToolsActivePort"), "utf8")
      ).split(/\r?\n/);
      const port = Number(portString);
      assert(Number.isInteger(port) && port > 0 && port <= 65535);
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1000),
      });
      assert(response.ok);
      const targets = await response.json();
      target = targets.find(
        (item) =>
          item.type === "page" && item.url === "freecoda://desktop/index.html",
      );
      if (target) {
        const endpoint = new URL(target.webSocketDebuggerUrl);
        assert.equal(endpoint.protocol, "ws:");
        assert(["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname));
        assert.equal(Number(endpoint.port), port);
        break;
      }
    } catch (error) {
      // File/HTTP endpoints appear after Chromium starts; preserve the final error for diagnostics.
      if (Date.now() >= deadline) throw error;
    }
    await pause(100);
  }
  assert(target, "Timed out waiting for the real desktop renderer (45s).");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  debuggingSocket = socket;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Desktop CDP connection timed out.")),
      10_000,
    );
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Could not connect to desktop CDP."));
      },
      { once: true },
    );
  });
  client = new CDP(socket);
  await client.send("Network.enable");
  // Observe requests without adding a test-only network policy: the shipped CSP
  // must independently reject the fetch probe below.
  await client.send("Runtime.enable");

  let initial;
  while (Date.now() < deadline) {
    initial = await client.evaluate(`(async () => {
      if (document.readyState !== 'complete' || !window.freecoda || !document.querySelector('#theme-toggle')) return null;
      return { title: document.title, text: document.body.innerText, state: await window.freecoda.getState(),
        requireType: typeof window.require, processType: typeof window.process,
        ipcType: typeof window.ipcRenderer, electronType: typeof window.electron,
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content };
    })()`, "initial renderer and preload state");
    if (initial) break;
    await pause(100);
  }
  assert(initial, "Desktop document and preload bridge did not become ready.");
  assert.equal(initial.title, "Freecoda");
  assert.match(initial.text, /freecoda/i);
  assert.equal(initial.state.workspace, null);
  assert.equal(initial.state.running, false);
  assert.equal(
    initial.state.auth.signedIn,
    false,
    "Smoke profile must be signed out.",
  );
  assert.deepEqual(initial.state.recentFolders, []);
  for (const key of ["requireType", "processType", "ipcType", "electronType"])
    assert.equal(
      initial[key],
      "undefined",
      `${key} must not be exposed to the renderer.`,
    );
  assert.match(initial.csp, /connect-src 'none'/);
  assert.match(initial.csp, /script-src 'self'/);
  assert(
    !initial.csp.includes("unsafe-eval") &&
      !initial.csp.includes("unsafe-inline"),
  );

  const navigation = await client.evaluate(`(() => {
    const controls = [...document.querySelectorAll('.titlebar-actions > button, .titlebar-actions > label')];
    return {
      titleRemoved: !document.querySelector('.titlebar .wordmark'),
      modelHidden: getComputedStyle(document.getElementById('model-label')).display === 'none',
      generalHistorySeparate: document.getElementById('workspace-conversations').parentElement.id === 'general-conversations',
      scope: document.getElementById('conversation-scope-label').textContent,
      controls: controls.map(control => {
        const icon = control.querySelector('svg:not([hidden])');
        const box = control.getBoundingClientRect();
        const graphic = icon?.getBoundingClientRect();
        return { icon: !!icon, label: control.getAttribute('aria-label') || control.querySelector('[aria-label]')?.getAttribute('aria-label') || control.getAttribute('aria-labelledby'),
          width: box.width, height: box.height,
          centered: !!graphic && Math.abs((graphic.x + graphic.width / 2) - (box.x + box.width / 2)) < 1 && Math.abs((graphic.y + graphic.height / 2) - (box.y + box.height / 2)) < 1 };
      })
    };
  })()`, "workspace navigation and header layout");
  assert.equal(navigation.titleRemoved, true);
  assert.equal(navigation.modelHidden, true);
  assert.equal(navigation.generalHistorySeparate, true);
  assert.equal(navigation.scope, "Your chats");
  assert.equal(navigation.controls.length, 4);
  for (const control of navigation.controls) {
    assert(control.icon && control.label && control.centered, "Header icons must be centered and labelled.");
    assert.equal(control.width, control.height);
  }

  const commands = await client.evaluate(`(() => {
    const prompt = document.getElementById('prompt');
    const menu = document.getElementById('slash-menu');
    const type = value => { prompt.value = value; prompt.dispatchEvent(new Event('input', { bubbles: true })); };
    prompt.focus(); type('/');
    const all = [...menu.querySelectorAll('strong')].map(node => node.textContent);
    const visible = !menu.hidden;
    type('/pla');
    const filtered = [...menu.querySelectorAll('strong')].map(node => node.textContent);
    prompt.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}));
    const completed = prompt.value;
    type('/');
    prompt.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true, cancelable:true}));
    const selected = prompt.getAttribute('aria-activedescendant');
    prompt.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
    const dismissed = menu.hidden;
    type('Keep my unfinished draft'); document.getElementById('commands-open').click();
    const preserved = prompt.value;
    type('');
    return { all, visible, filtered, completed, selected, dismissed, preserved,
      modeHidden: getComputedStyle(document.getElementById('mode').parentElement).display === 'none',
      toolsHidden: document.getElementById('workbench').hidden,
      syncButton: !!document.getElementById('sync-conversations') };
  })()`, "unified conversation slash commands");
  assert.equal(commands.visible, true);
  assert(commands.all.includes('/project') && commands.all.includes('/update'));
  assert(!commands.all.includes('/preview'), "Desktop must not suggest unsupported web commands.");
  assert(commands.filtered.includes('/plan'));
  assert.equal(commands.completed, '/plan ');
  assert.equal(commands.selected, 'slash-option-1');
  assert.equal(commands.dismissed, true);
  assert.equal(commands.preserved, 'Keep my unfinished draft');
  assert.equal(commands.modeHidden, true);
  assert.equal(commands.toolsHidden, true);
  assert.equal(commands.syncButton, false);

  const pluginNavigation = await client.evaluate(`(async () => {
    document.getElementById('extensions-open').click();
    const until = performance.now() + 3000;
    while (!document.getElementById('extensions-dialog').open && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
    const dialog = document.getElementById('extensions-dialog');
    const open = dialog.open;
    document.querySelector('[data-extension-view="mcp"]').click();
    const mcp = document.getElementById('extensions-list-title').textContent;
    const kind = document.getElementById('extension-kind').value;
    document.querySelector('[data-extension-view="tools"]').click();
    const tools = !document.getElementById('tool-choices').hidden && document.getElementById('extensions-form').hidden;
    document.querySelector('[data-extension-view="plugins"]').click();
    const plugins = !document.getElementById('desktop-plugin-section').hidden && document.getElementById('desktop-extension-section').hidden;
    document.getElementById('extensions-close').click();
    return {open, mcp, kind, tools, plugins, closed: !dialog.open};
  })()`, "real plugin category navigation without installation or connection");
  assert.equal(pluginNavigation.open, true);
  assert.equal(pluginNavigation.mcp, "Installed MCP connections");
  assert.equal(pluginNavigation.kind, "mcp");
  assert.equal(pluginNavigation.tools, true);
  assert.equal(pluginNavigation.plugins, true);
  assert.equal(pluginNavigation.closed, true);

  for (const preference of ["dark", "light", "system"]) {
    const theme = await client.evaluate(`(async () => {
      const requested = ${JSON.stringify(preference)};
      if (requested === 'system') {
        localStorage.setItem('freecoda-theme', 'system');
        window.dispatchEvent(new StorageEvent('storage', {key:'freecoda-theme', newValue:'system'}));
      } else if (document.documentElement.dataset.theme !== requested || document.documentElement.dataset.themePreference !== requested) {
        if (document.documentElement.dataset.theme === requested) document.getElementById('theme-toggle').click();
        document.getElementById('theme-toggle').click();
      }
      await window.freecoda.setTheme(requested);
      // Native theme IPC resolves before Chromium necessarily delivers its
      // media-query change. Wait for the UI to converge, then assert all state.
      const until = performance.now() + 2000;
      while (performance.now() < until) {
        // Xvfb and occluded native windows may suspend animation frames.
        // A timer keeps this convergence check bounded without depending on
        // window visibility or weakening the theme assertions below.
        await new Promise(resolve => setTimeout(resolve, 25));
        const expected = ${JSON.stringify(preference)} === 'system'
          ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : ${JSON.stringify(preference)};
        if (document.documentElement.dataset.theme === expected) break;
      }
      return { preference: document.documentElement.dataset.themePreference,
        theme: document.documentElement.dataset.theme,
        stored: localStorage.getItem('freecoda-theme'),
        systemDark: matchMedia('(prefers-color-scheme: dark)').matches };
    })()`, `${preference} theme convergence`);
    assert.equal(theme.preference, preference);
    assert.equal(theme.stored, preference);
    assert.equal(
      theme.theme,
      preference === "system"
        ? theme.systemDark
          ? "dark"
          : "light"
        : preference,
    );
  }
  const blocked = await client.evaluate(
    `fetch('https://example.invalid/freecoda-smoke').then(() => false, () => true)`,
  );
  assert.equal(blocked, true, "Renderer network must remain blocked by CSP.");
  assert.deepEqual(
    client.externalRequests,
    [],
    "Smoke must not issue external network requests.",
  );
  assert.equal(
    (await client.evaluate("window.freecoda.getState()")).workspace,
    null,
  );
  console.log(
    "PASS: real Electron renderer, isolated signed-out profile, typed bridge, no Node/raw IPC, CSP, Light/Dark/System themes.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  if (diagnostics) console.error("Electron diagnostics:\n" + diagnostics);
  process.exitCode = 1;
} finally {
  debuggingSocket?.close();
  if (child && child.exitCode === null && !child.signalCode) {
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await Promise.race([exited, pause(5000)]);
  }
  // Only the directory created by this invocation is eligible for cleanup.
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 6,
    retryDelay: 250,
  });
}
