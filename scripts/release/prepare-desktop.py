"""Validate native CI payloads and prepare binary-only public release assets."""
import base64
import hashlib
import os
from pathlib import Path
import re
import shutil
import sys
import yaml

source, output = map(Path, sys.argv[1:])
version = os.environ['RELEASE_VERSION']
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise ValueError('Stable semver required')
output.mkdir(parents=True, exist_ok=False)
metadata = {}
for platform, arch, extensions, feed in [
    ('linux', 'x64', ['.AppImage', '.deb'], 'latest-linux.yml'),
    ('win', 'x64', ['.exe'], 'latest.yml'),
    ('mac', 'x64', ['.dmg', '.zip'], 'latest-mac.yml'),
    ('mac', 'arm64', ['.dmg', '.zip'], 'latest-mac.yml'),
]:
    directory = source / f'{platform}-{arch}'
    expected = {f'Freecoda-{version}-{platform}-{arch}{extension}' for extension in extensions}
    for name in expected:
        file = directory / name
        if not file.is_file() or file.is_symlink():
            raise ValueError(f'Missing installer: {name}')
    checksums = {}
    for line in (directory / 'SHA256SUMS.txt').read_text().splitlines():
        digest, name = line.split('  ', 1)
        checksums[name] = digest
    for name in expected:
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != checksums.get(name):
            raise ValueError(f'Installer checksum mismatch: {name}')
    data = yaml.safe_load((directory / feed).read_text())
    if data.get('version') != version or not isinstance(data.get('files'), list):
        raise ValueError(f'Invalid updater metadata: {feed}')
    for entry in data['files']:
        name = entry['url']
        if name not in expected:
            raise ValueError(f'Unexpected updater path: {name}')
        payload = (directory / name).read_bytes()
        if base64.b64encode(hashlib.sha512(payload).digest()).decode() != entry['sha512'] or len(payload) != entry['size']:
            raise ValueError(f'Updater checksum mismatch: {name}')
    # Publish only fields needed by electron-updater, never arbitrary CI metadata.
    data = {'version': version, 'files': [
        {key: entry[key] for key in ('url', 'sha512', 'size')}
        for entry in data['files']
    ]}
    wanted = '.zip' if platform == 'mac' else '.exe' if platform == 'win' else '.AppImage'
    if not any(entry['url'].endswith(wanted) for entry in data['files']):
        raise ValueError(f'Missing updater installer for {platform}/{arch}')
    if feed in metadata:
        metadata[feed]['files'].extend(data['files'])
    else:
        metadata[feed] = data
    for name in expected:
        shutil.copyfile(directory / name, output / name)
        blockmap = directory / f'{name}.blockmap'
        if blockmap.is_file() and not blockmap.is_symlink():
            shutil.copyfile(blockmap, output / blockmap.name)
for name, data in metadata.items():
    (output / name).write_text(yaml.safe_dump(data, sort_keys=False))
checksums = [f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}' for file in sorted(output.iterdir())]
(output / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n')
print(f'Validated {len(checksums)} public binary/update assets; source files excluded')
