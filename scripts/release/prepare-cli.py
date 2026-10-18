"""Validate a binary-only npm archive before publishing public CLI assets."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tarfile

FILES = frozenset({
    'LICENSE', 'NOTICE', 'README.md', 'bin/freecoda.js', 'dist/index.js',
    'dist/index.js.map', 'dist/THIRD_PARTY_NOTICES.txt', 'package.json',
})
MAX_ARCHIVE = 10 * 1024 * 1024
MAX_EXPANDED = 30 * 1024 * 1024
MAX_FILE = 30 * 1024 * 1024


def prepare(source: Path, output: Path, version: str) -> None:
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
        raise ValueError('Stable semver required')
    archive_name = f'freecoda-{version}.tgz'
    if source.is_symlink() or not source.is_dir():
        raise ValueError('Incoming directory required')
    entries = list(source.iterdir())
    if {entry.name for entry in entries} != {archive_name, 'SHA256SUMS'}:
        raise ValueError('Exactly the archive and SHA256SUMS are required')
    if any(entry.is_symlink() or not entry.is_file() for entry in entries):
        raise ValueError('Regular release files required')
    archive = source / archive_name
    manifest = source / 'SHA256SUMS'
    if not 0 < archive.stat().st_size <= MAX_ARCHIVE or manifest.stat().st_size > 1024:
        raise ValueError('Release file size limit exceeded')
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if manifest.read_bytes() != f'{digest}  {archive_name}\n'.encode('ascii'):
        raise ValueError('Invalid checksum manifest')
    expected = {'package/' + name for name in FILES}
    seen = set()
    expanded = 0
    with tarfile.open(archive, mode='r|gz') as package:
        for member in package:
            if len(seen) >= len(expected) or member.name not in expected or member.name in seen:
                raise ValueError('Unexpected or duplicate package path')
            if not member.isfile() or member.issparse() or member.size < 0 or member.size > MAX_FILE:
                raise ValueError('Invalid package member')
            expanded += member.size
            if expanded > MAX_EXPANDED:
                raise ValueError('Expanded package limit exceeded')
            seen.add(member.name)
            if member.name == 'package/package.json':
                if member.size > 65536:
                    raise ValueError('Package metadata size limit exceeded')
                stream = package.extractfile(member)
                if stream is None:
                    raise ValueError('Missing package metadata')
                metadata = json.loads(stream.read(65537))
                if not isinstance(metadata, dict) or metadata.get('name') != 'freecoda' or metadata.get('version') != version:
                    raise ValueError('Package identity mismatch')
    if seen != expected:
        raise ValueError('Missing package files')
    # Never merge into an existing directory or overwrite unrelated files.
    output.mkdir(parents=True, exist_ok=False)
    for name in (archive_name, 'SHA256SUMS'):
        shutil.copyfile(source / name, output / name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('incoming', type=Path)
    parser.add_argument('out', type=Path)
    parser.add_argument('version')
    args = parser.parse_args()
    try:
        prepare(args.incoming, args.out, args.version)
    except (ValueError, OSError, tarfile.TarError, UnicodeError):
        parser.exit(1, 'CLI release validation failed\n')
    print('Validated two public CLI release assets')


if __name__ == '__main__':
    main()
