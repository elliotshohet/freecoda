#!/usr/bin/env python3
"""Copy and verify legacy GitHub releases. Never deletes the source repository.

Requires authenticated gh with contents-write permission on the destination.
Run from the workspace root: python3 scripts/release/migrate-releases.py
Downloads are cached beneath .data/release-migration (approximately 4.9 GB).
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import pathlib
import subprocess

SOURCE = 'elliotshohet/freecoda-releases'
DESTINATION = 'elliotshohet/freecoda'
CACHE = pathlib.Path('.data/release-migration')


def gh(*args):
    return subprocess.check_output(['gh', *args])


def api(path):
    return json.loads(gh('api', path))


def destination_release(tag):
    # GitHub's tags endpoint omits drafts; list releases to support resumable copies.
    pages = json.loads(gh('api', '--paginate', '--slurp', f'repos/{DESTINATION}/releases?per_page=100'))
    return next((release for page in pages for release in page if release['tag_name'] == tag), None)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return 'sha256:' + result.hexdigest()


def main():
    gh('auth', 'status')
    # Snapshot every page before writing anything; retain release metadata as evidence.
    releases = json.loads(gh('api', '--paginate', '--slurp', f'repos/{SOURCE}/releases?per_page=100'))
    releases = [release for page in releases for release in page]
    latest = api(f'repos/{SOURCE}/releases/latest')['tag_name']
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / 'source-releases.json').write_text(json.dumps(releases, indent=2) + '\n')
    # Preserve the exact original tag objects and commits before creating releases.
    subprocess.run(['git', 'fetch', f'https://github.com/{SOURCE}.git', 'refs/tags/*:refs/tags/*'], check=True)
    for release in reversed(releases):
        tag = release['tag_name']
        subprocess.run(['git', 'push', f'git@github.com:{DESTINATION}.git', f'refs/tags/{tag}:refs/tags/{tag}'], check=True)
        directory = CACHE / tag
        directory.mkdir(exist_ok=True)
        # Download through gh, then require GitHub's stored size and SHA-256 digest.
        def download(asset):
            path = directory / asset['name']
            if path.exists() and path.stat().st_size == asset['size'] and digest(path) == asset.get('digest'):
                return
            gh('release', 'download', tag, '--repo', SOURCE, '--dir', str(directory), '--pattern', asset['name'], '--clobber')
        with ThreadPoolExecutor(max_workers=4) as executor:
            list(executor.map(download, release['assets']))
        for asset in release['assets']:
            path = directory / asset['name']
            assert path.stat().st_size == asset['size'], f'Size mismatch: {path}'
            assert asset.get('digest') and digest(path) == asset['digest'], f'Digest mismatch: {path}'
        existing = destination_release(tag)
        if existing is None:
            notes = directory / 'release-notes.md'
            notes.write_text(release.get('body') or '')
            gh('release', 'create', tag, '--repo', DESTINATION, '--draft', '--title', release['name'] or tag, '--notes-file', str(notes))
            existing = destination_release(tag)
        expected = {asset['name']: asset['digest'] for asset in release['assets']}
        if not existing['draft']:
            assert {asset['name']: asset['digest'] for asset in existing['assets']} == expected, f'Published destination differs: {tag}'
        else:
            assert not any(asset['name'] not in expected for asset in existing['assets']), f'Unexpected destination assets: {tag}'
            gh('release', 'upload', tag, '--repo', DESTINATION, '--clobber', *[str(directory / asset['name']) for asset in release['assets']])
            copied = destination_release(tag)
            assert {asset['name']: asset['digest'] for asset in copied['assets']} == expected, f'Uploaded bytes differ: {tag}'
            if not release['draft']:
                gh('release', 'edit', tag, '--repo', DESTINATION, '--draft=false', f'--prerelease={str(release["prerelease"]).lower()}', f'--latest={str(tag == latest).lower()}')
        print(f'Verified {tag}: {len(expected)} assets')
    assert api(f'repos/{DESTINATION}/releases/latest')['tag_name'] == latest
    print('All releases copied and SHA-256 verified. Source repository retained.')


if __name__ == '__main__':
    main()
