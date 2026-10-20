#!/bin/sh
# Freecoda CLI installer. The published release and digest are deliberately pinned.
set -eu
umask 077

version=0.1.10
artifact=freecoda-0.1.10.tgz
expected=8f2a144e1371afee16b830b605c557787848b61832f2ae610bae375d0a696f8f
release=https://github.com/elliotshohet/freecoda/releases/download/cli-v0.1.10
check_only=false
case ${1-} in
  '') ;;
  --check) check_only=true ;;
  *) printf '%s\n' 'Usage: sh install.sh [--check]' >&2; exit 1 ;;
esac
[ "$#" -le 1 ] || { printf '%s\n' 'Unexpected installer arguments.' >&2; exit 1; }
fail() { printf 'Freecoda: %s\n' "$1" >&2; exit 1; }

case $(uname -s) in
  Darwin|Linux) ;;
  *) fail 'This installer supports macOS, Linux, and Linux Node.js inside WSL. Use the documented archive installation on other platforms.' ;;
esac
for tool in node npm curl mktemp; do
  command -v "$tool" >/dev/null 2>&1 || fail "Install $tool first, then run this installer again. No system packages were changed."
done
node -e 'if (!['\''darwin'\'', '\''linux'\''].includes(process.platform) || Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || fail 'Use Node.js 22 or newer for macOS/Linux. In WSL, use Linux Node.js rather than Windows Node.js.'
[ "$(id -u)" != 0 ] || fail 'Run this installer as your normal user, without sudo.'

work=$(mktemp -d "${TMPDIR:-/tmp}/freecoda-install.XXXXXXXX") || fail 'Could not create a private temporary directory.'
cleanup() { [ -n "${work-}" ] && rm -rf "$work"; }
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' HUP TERM
fetch() {
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --location \
    --connect-timeout 15 --max-time 120 --retry 2 --max-filesize "$3" --output "$2" "$1"
}
printf 'Verifying Freecoda CLI %s from the canonical GitHub release…\n' "$version"
fetch "$release/SHA256SUMS.txt" "$work/SHA256SUMS.txt" 16384 || fail 'Could not download the release checksums; nothing was installed.'
fetch "$release/$artifact" "$work/$artifact" 33554432 || fail 'Could not download the release archive; nothing was installed.'
node - "$work/SHA256SUMS.txt" "$work/$artifact" "$artifact" "$expected" <<'JS'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [manifest, archive, name, pinned] = process.argv.slice(2);
const rows = fs.readFileSync(manifest, 'utf8').split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?([^\s]+)$/.exec(line)).filter(row => row && row[2] === name);
if (rows.length !== 1 || rows[0][1] !== pinned) {
  console.error('Release checksum does not match the pinned release. Nothing was installed.');
  process.exit(1);
}
if (fs.statSync(archive).size > 32 * 1024 * 1024 || crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== pinned) {
  console.error('Archive checksum mismatch. Nothing was installed.');
  process.exit(1);
}
JS
if [ "$check_only" = true ]; then
  printf 'Verified %s (SHA-256 %s). Check only; nothing was installed.\n' "$artifact" "$expected"
  exit 0
fi
[ -n "${HOME-}" ] || fail 'HOME is required. Set FREECODA_INSTALL_PREFIX to a user-owned absolute path and supply HOME.'
prefix=${FREECODA_INSTALL_PREFIX:-"$HOME/.local/share/freecoda"}
case $prefix in /*) ;; *) fail 'FREECODA_INSTALL_PREFIX must be an absolute path.' ;; esac
[ ! -L "$prefix" ] || fail 'The install prefix is a symlink. Choose a separate user-owned directory.'
node - "$prefix" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
try {
const prefix = path.resolve(process.argv[2]);
if (prefix === path.parse(prefix).root) throw Error('The filesystem root is not an installation prefix.');
let ancestor = prefix;
while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
if (!fs.statSync(ancestor).isDirectory() || fs.statSync(ancestor).uid !== process.getuid() || (fs.statSync(ancestor).mode & 0o022)) {
  throw Error('Choose a prefix inside a user-owned directory that is not group/world writable. Do not use sudo.');
}
for (const directory of ['bin', 'lib', 'lib/node_modules']) {
  try {
    const stat = fs.lstatSync(path.join(prefix, directory));
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o022)) {
      throw Error('Existing installation directories must be user-owned ordinary directories that are not group/world writable.');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const target of ['bin/freecoda', 'lib/node_modules/freecoda']) {
  try {
    fs.lstatSync(path.join(prefix, target));
    console.error('An installation already exists at ' + path.join(prefix, target) + '. It was left unchanged. Use its update command or choose another prefix.');
    process.exit(1);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
} catch (error) { console.error('Freecoda: ' + error.message); process.exit(1); }
JS
mkdir -p "$prefix" || fail 'Could not create the user-owned installation directory.'
# The archive is verified first. Offline installation forbids dependency fetching;
# lifecycle scripts, audit requests, funding prompts, and update checks are disabled.
: > "$work/npm-user.conf"
: > "$work/npm-global.conf"
npm install --global "$work/$artifact" --prefix "$prefix" --cache "$work/npm-cache" --userconfig "$work/npm-user.conf" --globalconfig "$work/npm-global.conf" --ignore-scripts --offline --no-audit --no-fund --update-notifier=false || fail 'npm could not complete the installation. Inspect the selected prefix before retrying.'
printf '\nFreecoda CLI %s installed at:\n  %s/bin/freecoda\n' "$version" "$prefix"
printf 'Run it directly with:\n  "%s/bin/freecoda"\n' "$prefix"
printf 'To add it to future terminal sessions, add this directory to PATH using your shell settings:\n  %s/bin\n' "$prefix"
printf 'For the default prefix, use: export PATH="$HOME/.local/share/freecoda/bin:$PATH"\n'
printf '%s\n' 'No shell profiles, existing CLI installations, account credentials, or system packages were changed.'
