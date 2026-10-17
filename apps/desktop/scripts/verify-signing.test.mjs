import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifySigning } from './verify-signing.mjs';

test('unsigned builds cannot claim verified signing or invoke native checks', async () => {
  const result = await verifySigning({ platform: 'mac', directory: 'unused', configured: false, run() { throw Error('unexpected'); } });
  assert.equal(result.status, 'unsigned');
  assert.deepEqual(result.checks, []);
});
test('mac checks actual ZIP app identity, strict signature, stapling and Gatekeeper; rejects ad hoc identity', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'signature-test-'));
  try {
    await writeFile(path.join(directory, 'Freecoda.zip'), 'fixture');
    await writeFile(path.join(directory, 'Freecoda.dmg'), 'fixture');
    const calls = [];
    let identity = 'Authority=Developer ID Application: Fixture';
    const run = (program, args) => {
      calls.push([program, args]);
      if (program === 'ditto') mkdirSync(path.join(args.at(-1), 'Freecoda.app'));
      return program === 'codesign' && args[0] === '--display' ? identity : 'accepted';
    };
    const result = await verifySigning({ platform: 'mac', directory, configured: true, run });
    assert.equal(result.status, 'verified');
    assert.equal(calls.filter(([p]) => p === 'spctl').length, 2);
    assert.equal(calls.filter(([p]) => p === 'xcrun').length, 2);
    assert.ok(calls.some(([p, a]) => p === 'codesign' && a.includes('--strict')));
    identity = 'Signature=adhoc';
    await assert.rejects(verifySigning({ platform: 'mac', directory, configured: true, run }), /Developer ID/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('Windows requires successful native Authenticode trust and timestamp; verification failures propagate', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'signature-test-'));
  try {
    await writeFile(path.join(directory, 'Freecoda.exe'), 'fixture');
    const run = (program, args) => {
      assert.equal(program, 'powershell.exe');
      assert.match(args.at(-1), /Get-AuthenticodeSignature/);
      assert.match(args.at(-1), /TimeStamperCertificate/);
      assert.match(args.at(-1), /Status -ne 'Valid'/);
      throw Error('untrusted signature');
    };
    await assert.rejects(verifySigning({ platform: 'win', directory, configured: true, run }), /untrusted/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
