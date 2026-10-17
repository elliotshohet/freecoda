/** Published binaries only. No runtime hooks, application rewrites, provider calls, or sandbox bypass. */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, chmod, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

assert(['win32', 'linux'].includes(platform()), 'Qualification requires native Windows/Linux.');
assert(process.env.CI === 'true', 'Run only on a disposable CI runner.');
const from = process.env.FROM_VERSION, to = process.env.TO_VERSION;
for (const version of [from, to]) assert(/^\d+\.\d+\.\d+$/.test(version), 'Stable semver required.');
assert.notEqual(from, to);
assert.equal(from, '0.1.0', 'This qualification pins the reviewed 0.1.0 source release.');
assert.equal(to, '0.1.1', 'This qualification pins the reviewed 0.1.1 destination release.');
const pinnedDigests = {
  win32: {
    from: 'sha256:3d33ed6acf35d24d5ec5ae04269a95f97d034490abf26b76d86ccf3c6a8deef3',
    to: 'sha256:9ed00e1bee362bdf3a99ebcdac810715e09b625f25d118c74de9243c2843e75a',
  },
  linux: {
    from: 'sha256:bb2620d4065d31773a4029c551eea436bf39d53dd36913ebe5283becf42939c8',
    to: 'sha256:fbb4a50b51926819c3291b6f259e7f39781686705aa12bf6f12bd421e1aef18f',
  },
};
const run = promisify(execFile);
const root = await mkdtemp(path.join(process.env.RUNNER_TEMP || tmpdir(), 'freecoda-upgrade-'));
const profile = path.join(root, 'profile');
const evidence = path.resolve('.data/desktop-upgrade-evidence');
await mkdir(evidence, { recursive: true });
const req = createRequire(new URL('../package.json', import.meta.url));
const asar = createRequire(req.resolve('electron-builder/package.json'))('@electron/asar');
const repo = 'https://api.github.com/repos/elliotshohet/freecoda-releases';
const pause = ms => new Promise(r => setTimeout(r, ms));
const sha = data => createHash('sha256').update(data).digest('hex');
const events = [];
let child, ws, client;
let spawnError;
let diagnostics = '';
function record(message) { events.push({ time: new Date().toISOString(), message }); console.log(message); }
async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  assert(r.ok, `Public release HTTP ${r.status}`); return r.json();
}
async function download(asset, output) {
  assert(asset.browser_download_url.startsWith('https://github.com/elliotshohet/freecoda-releases/releases/download/'));
  const r = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(180_000) });
  assert(r.ok); const bytes = Buffer.from(await r.arrayBuffer());
  assert.equal(bytes.length, asset.size); assert.equal('sha256:' + sha(bytes), asset.digest);
  await writeFile(output, bytes); return output;
}
async function waitFor(description, check, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await pause(500); }
  throw new Error(`Timed out: ${description}`);
}
async function connect() {
  const target = await waitFor('desktop renderer', async () => {
    if (spawnError) throw spawnError;
    assert(child.exitCode === null && !child.signalCode, 'Desktop exited before renderer.');
    try {
      const port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]);
      const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      return (await r.json()).find(t => t.url === 'freecoda://desktop/index.html');
    } catch { return null; }
  }, 45_000);
  const endpoint = new URL(target.webSocketDebuggerUrl);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname));
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP timeout')), 10_000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data)); const callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); callback(message); }
  });
  client = async (method, params = {}) => {
    const result = await Promise.race([
      new Promise(resolve => { pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params })); }),
      pause(10_000).then(() => { throw new Error(`CDP timed out: ${method}`); }),
    ]);
    assert(!result.error, JSON.stringify(result.error)); return result.result;
  };
}
async function rendererProof(label) {
  await waitFor('complete desktop document and preload bridge', async () => {
    const readiness = await client('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && typeof window.freecoda === 'object' && !!document.querySelector('#theme-select')`,
      returnByValue: true,
    });
    assert(!readiness.exceptionDetails, JSON.stringify(readiness.exceptionDetails));
    return readiness.result.value === true;
  }, 45_000);
  const result = await client('Runtime.evaluate', {
    expression: `(async()=>({url:location.href,node:typeof process,require:typeof require,rawIPC:typeof ipcRenderer,state:await window.freecoda.getState()}))()`,
    awaitPromise: true, returnByValue: true,
  });
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); const data = result.result.value;
  assert.equal(data.url, 'freecoda://desktop/index.html');
  assert.equal(data.node, 'undefined'); assert.equal(data.require, 'undefined'); assert.equal(data.rawIPC, 'undefined');
  assert.equal(data.state.auth.signedIn, false); assert.equal(data.state.workspace, null); assert.equal(data.state.running, false);
  await writeFile(path.join(evidence, `${label}.json`), JSON.stringify(data, null, 2));
  const screenshot = await client('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidence, `${label}.png`), Buffer.from(screenshot.data, 'base64'));
}
async function launch(executable) {
  await mkdir(profile, { recursive: true });
  // Remove stale port file before attaching to a new process.
  const { rm } = await import('node:fs/promises'); await rm(path.join(profile, 'DevToolsActivePort'), { force: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
  child = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  spawnError = undefined;
  child.on('error', error => { spawnError = error; diagnostics += String(error); });
  for (const s of [child.stdout, child.stderr]) s.on('data', b => { diagnostics = (diagnostics + b).slice(-24_000); });
  await connect();
}
async function normalClose() {
  if (platform() === 'win32') {
    // Exercise the actual native close confirmation. No IPC/test hooks.
    const script = `
      Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes;
      $w=New-Object -ComObject WScript.Shell;
      if(-not $w.AppActivate(${child.pid})){throw 'Cannot focus Freecoda'};
      Start-Sleep -Milliseconds 400; $w.SendKeys('%{F4}');
      $condition=[System.Windows.Automation.AndCondition]::new(
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty,${child.pid}),
        [System.Windows.Automation.AndCondition]::new(
          [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'Close workspace'),
          [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)
        )
      );
      $deadline=(Get-Date).AddSeconds(10); $button=$null;
      while((Get-Date) -lt $deadline -and $null -eq $button){
        $button=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition);
        if($null -eq $button){Start-Sleep -Milliseconds 200}
      };
      if($null -eq $button){throw 'Native Close workspace confirmation was not found'};
      $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke();
    `;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  } else {
    const { stdout } = await run('xdotool', ['search', '--onlyvisible', '--name', '^Freecoda$']);
    const id = stdout.trim().split(/\s+/)[0]; assert(id);
    await run('xdotool', ['windowactivate', '--sync', id, 'key', 'alt+F4']);
    await pause(1000);
    const { stdout: dialog } = await run('xdotool', ['search', '--onlyvisible', '--name', 'Close Freecoda']);
    await run('xdotool', ['windowactivate', '--sync', dialog.trim().split(/\s+/)[0], 'key', 'Right', 'Return']);
  }
  await waitFor('normal application exit', () => {
    assert(!child.signalCode, `Application was terminated by ${child.signalCode}.`);
    if (child.exitCode === null) return false;
    assert.equal(child.exitCode, 0, 'Application quit with an error.');
    return true;
  }, 30_000);
  ws?.close(); record('Normal close completed with exit code zero.');
}
try {
  const [oldRelease, latest] = await Promise.all([getJSON(`${repo}/releases/tags/v${from}`), getJSON(`${repo}/releases/latest`)]);
  assert.equal(latest.tag_name, `v${to}`, 'Stable feed moved; qualify the actual latest release.');
  assert(!oldRelease.draft && !latest.draft && !latest.prerelease);
  const suffix = platform() === 'win32' ? 'win-x64.exe' : 'linux-x86_64.AppImage';
  const oldAsset = oldRelease.assets.find(a => a.name === `Freecoda-${from}-${suffix}`);
  const newAsset = latest.assets.find(a => a.name === `Freecoda-${to}-${suffix}`);
  assert(oldAsset && newAsset);
  assert.equal(oldAsset.digest, pinnedDigests[platform()].from, 'Source installer identity changed.');
  assert.equal(newAsset.digest, pinnedDigests[platform()].to, 'Destination installer identity changed.');
  const oldInstaller = await download(oldAsset, path.join(root, oldAsset.name));
  let executable, installedAsar;
  if (platform() === 'win32') {
    const install = path.join(root, 'installed');
    await run(oldInstaller, ['/S', '/currentuser', `/D=${install}`], { timeout: 120_000 });
    executable = path.join(install, 'freecoda.exe'); installedAsar = path.join(install, 'resources', 'app.asar');
    assert.equal(JSON.parse(asar.extractFile(installedAsar, 'package.json')).version, from);
  } else {
    executable = oldInstaller; await chmod(executable, 0o755);
  }
  record(`Installed verified published ${from} binary.`);
  await launch(executable); await rendererProof('before');
  const cacheRoot = platform() === 'win32' ? process.env.LOCALAPPDATA : (process.env.XDG_CACHE_HOME || path.join(process.env.HOME, '.cache'));
  assert(cacheRoot);
  const pendingDirectory = path.join(cacheRoot, '@freecodadesktop-updater', 'pending');
  const downloaded = await waitFor('real SDK update download matching stable installer', async () => {
    try {
      const names = await readdir(pendingDirectory);
      for (const name of names) {
        if (!name.endsWith(platform() === 'win32' ? '.exe' : '.AppImage')) continue;
        const file = path.join(pendingDirectory, name), data = await readFile(file);
        if ('sha256:' + sha(data) === newAsset.digest) return file;
      }
    } catch { /* SDK cache is created during automatic download. */ }
    return null;
  });
  record(`Actual electron-updater downloaded exact published ${to} installer (${path.basename(downloaded)}).`);
  await normalClose();
  if (platform() === 'win32') {
    await waitFor('NSIS replaced installed app with new version', async () => {
      try { return JSON.parse(asar.extractFile(installedAsar, 'package.json')).version === to; } catch { return false; }
    }, 120_000);
  } else {
    executable = path.join(root, newAsset.name);
    await waitFor('AppImage replacement', async () => {
      try { return 'sha256:' + sha(await readFile(executable)) === newAsset.digest; } catch { return false; }
    });
  }
  record(`Normal quit installed ${to}; verified installed version/binary identity.`);
  await launch(executable); await rendererProof('after');
  record(`PASS: genuine published ${from} -> ${to} SDK download, normal quit/install, and relaunched renderer.`);
} catch (error) {
  record(`FAIL: ${error.stack || error}`); process.exitCode = 1;
  // Capture the actual OS dialog/focus state before cleanup, even if CDP failed.
  try {
    const screenshot = path.join(evidence, 'failure-native-desktop.png');
    if (platform() === 'win32') {
      const output = screenshot.replaceAll("'", "''");
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $r=[System.Windows.Forms.SystemInformation]::VirtualScreen; $b=New-Object System.Drawing.Bitmap($r.Width,$r.Height); $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($r.Left,$r.Top,0,0,$b.Size); $b.Save('${output}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose();`,
      ], { timeout: 10_000 });
    } else await run('scrot', [screenshot], { timeout: 10_000 });
  } catch { record('Native failure screenshot unavailable; diagnostic log retained.'); }
} finally {
  ws?.close();
  if (child && child.exitCode === null && !child.signalCode) {
    if (platform() === 'win32') await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
    else child.kill('SIGKILL');
  }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ from, to, platform: platform(), events, diagnostics }, null, 2));
}
