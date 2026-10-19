import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readInstalledVersion } from './upgrade-version.mjs';
const requireDesktop = createRequire(new URL('../package.json', import.meta.url));
const asar = createRequire(requireDesktop.resolve('electron-builder/package.json'))('@electron/asar');

test('reads a replaced ASAR using its fresh header instead of cached offsets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'freecoda-asar-replacement-'));
  try {
    for (const [name, version] of [['old', '0.1.0'], ['new', '0.1.1']]) {
      const directory = path.join(root, name);
      await mkdir(directory);
      await writeFile(path.join(directory, 'package.json'), JSON.stringify({ version }));
      if (name === 'new') await writeFile(path.join(directory, 'aaa-notices.txt'), 'NEW LICENSE HEADER CONTENT\n'.repeat(100));
      await asar.createPackage(directory, path.join(root, `${name}.asar`));
    }
    const installed = path.join(root, 'installed.asar');
    await copyFile(path.join(root, 'old.asar'), installed);
    assert.equal(readInstalledVersion(asar, installed), '0.1.0');
    await copyFile(path.join(root, 'new.asar'), installed);
    // Reproduce the real updater harness failure: old offsets now read notice bytes.
    assert.throws(() => JSON.parse(asar.extractFile(installed, 'package.json').toString('utf8')));
    assert.equal(readInstalledVersion(asar, installed), '0.1.1');
  } finally {
    asar.uncacheAll();
    await rm(root, { recursive: true, force: true });
  }
});

test('qualification accepts the reviewed current pair and rejects unreviewed releases/platforms', async () => {
  const { pinnedUpgrade } = await import('./upgrade-pins.mjs');
  const workflow = await import('node:fs/promises').then(fs => fs.readFile(new URL('../../../.github/workflows/desktop-upgrade.yml', import.meta.url), 'utf8'));
  const from = workflow.match(/from_version:[\s\S]*?default: (\d+\.\d+\.\d+)/)?.[1];
  const to = workflow.match(/to_version:[\s\S]*?default: (\d+\.\d+\.\d+)/)?.[1];
  assert(from && to, 'Workflow must select stable version defaults');
  for (const platform of ['linux', 'win32']) {
    const pins = pinnedUpgrade(from, to, platform);
    assert.match(pins.from, /^sha256:[0-9a-f]{64}$/);
    assert.match(pins.to, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(pins.from, pins.to);
  }
  assert.throws(() => pinnedUpgrade(from, '999.999.999', 'linux'), /Unreviewed/);
  assert.throws(() => pinnedUpgrade(from, to, 'darwin'), /Unreviewed/);
});
