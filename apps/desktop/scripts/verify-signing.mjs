import { readdir, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function verifySigning({ platform, directory, configured, run = command }) {
  const receipt = { platform, configured, status: configured ? 'verified' : 'unsigned', checks: [] };
  const check = (program, args) => {
    const output = run(program, args);
    receipt.checks.push({ program, args, output: output.trim() });
    return output;
  };
  if (!configured) return receipt;
  const files = await readdir(directory);
  if (platform === 'mac') {
    const zips = files.filter(file => file.endsWith('.zip'));
    const dmgs = files.filter(file => file.endsWith('.dmg'));
    if (!zips.length || !dmgs.length) throw new Error('Signed macOS ZIP and DMG are required');
    for (const zip of zips) {
      const temporary = await mkdtemp(path.join(tmpdir(), 'freecoda-signature-'));
      try {
        check('ditto', ['-x', '-k', path.resolve(directory, zip), temporary]);
        const apps = (await readdir(temporary)).filter(file => file.endsWith('.app'));
        if (apps.length !== 1) throw new Error('Expected exactly one packaged app in ZIP');
        const app = path.join(temporary, apps[0]);
        check('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
        const identity = check('codesign', ['--display', '--verbose=4', app]);
        if (!/^Authority=Developer ID Application:/m.test(identity)) throw new Error('Developer ID Application identity required');
        check('xcrun', ['stapler', 'validate', app]);
        check('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
    for (const dmg of dmgs) {
      const target = path.resolve(directory, dmg);
      check('xcrun', ['stapler', 'validate', target]);
      check('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', target]);
    }
  } else if (platform === 'win') {
    const installers = files.filter(file => file.endsWith('.exe'));
    if (!installers.length) throw new Error('Signed Windows installer is required');
    for (const file of installers) {
      const literal = path.resolve(directory, file).replaceAll("'", "''");
      check('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath '${literal}'; if($s.Status -ne 'Valid' -or !$s.SignerCertificate -or !$s.TimeStamperCertificate){throw 'Installer requires valid Authenticode signature and timestamp'}; [pscustomobject]@{Status=[string]$s.Status;Subject=$s.SignerCertificate.Subject;Thumbprint=$s.SignerCertificate.Thumbprint;TimestampSubject=$s.TimeStamperCertificate.Subject}|ConvertTo-Json -Compress`]);
    }
  } else throw new Error('Signing verification is unsupported on this platform');
  return receipt;
}
function command(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 120_000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${program} verification failed: ${result.error?.message ?? `${result.stdout}\n${result.stderr}`}`);
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = path.resolve('apps/desktop/release');
  await mkdir(directory, { recursive: true });
  let receipt;
  try {
    receipt = await verifySigning({ platform: process.env.SIGNING_PLATFORM, directory, configured: process.env.SIGNING_CONFIGURED === 'true' });
  } catch (error) {
    receipt = { platform: process.env.SIGNING_PLATFORM, configured: true, status: 'failed', error: error.message };
    process.exitCode = 1;
  }
  await writeFile(path.join(directory, `signing-verification-${process.env.SIGNING_PLATFORM}-${process.env.SIGNING_ARCH}.json`), JSON.stringify(receipt, null, 2) + '\n');
  console.log(`Signing verification: ${receipt.status}`);
}
