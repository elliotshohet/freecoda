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
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
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
      if (document.readyState !== 'complete' || !window.freecoda || !document.querySelector('#theme-select')) return null;
      return { title: document.title, text: document.body.innerText, state: await window.freecoda.getState(),
        requireType: typeof window.require, processType: typeof window.process,
        ipcType: typeof window.ipcRenderer, electronType: typeof window.electron,
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content };
    })()`);
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

  for (const preference of ["dark", "light", "system"]) {
    const theme = await client.evaluate(`(async () => {
      const select = document.getElementById('theme-select');
      select.value = ${JSON.stringify(preference)};
      select.dispatchEvent(new Event('change', {bubbles:true}));
      await window.freecoda.setTheme(${JSON.stringify(preference)});
      return { preference: document.documentElement.dataset.themePreference,
        theme: document.documentElement.dataset.theme,
        stored: localStorage.getItem('freecoda-theme'),
        systemDark: matchMedia('(prefers-color-scheme: dark)').matches };
    })()`);
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
