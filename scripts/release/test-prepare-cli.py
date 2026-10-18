import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('prepare_cli', Path(__file__).with_name('prepare-cli.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class CliRelease(unittest.TestCase):
    def fixture(self, root, changes=None, extra=None, omit=None):
        source = root / 'incoming'
        source.mkdir()
        archive = source / 'freecoda-0.1.5.tgz'
        with tarfile.open(archive, 'w:gz') as tar:
            for name in sorted(release.FILES):
                if name == omit:
                    continue
                data = json.dumps({'name': 'freecoda', 'version': '0.1.5'}).encode() if name == 'package.json' else b'binary payload'
                member = tarfile.TarInfo('package/' + name)
                if changes:
                    member, data = changes(member, data)
                member.size = len(data)
                tar.addfile(member, io.BytesIO(data))
            if extra:
                tar.addfile(extra, io.BytesIO(b''))
        self.checksum(source)
        return source

    def checksum(self, source):
        archive = source / 'freecoda-0.1.5.tgz'
        (source / 'SHA256SUMS').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')

    def test_valid_copies_only_two_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.fixture(root)
            release.prepare(source, root / 'out', '0.1.5')
            self.assertEqual({p.name for p in (root / 'out').iterdir()}, {p.name for p in source.iterdir()})
            for file in source.iterdir():
                self.assertEqual(file.read_bytes(), (root / 'out' / file.name).read_bytes())

    def test_rejects_paths_duplicates_links_and_missing_files(self):
        for path, kind in [('package/../secret', tarfile.REGTYPE), ('/secret', tarfile.REGTYPE), ('package/.env', tarfile.REGTYPE), ('package/dist/index.js', tarfile.REGTYPE), ('package/link', tarfile.SYMTYPE), ('package/link', tarfile.LNKTYPE)]:
            with self.subTest(path=path, kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                extra = tarfile.TarInfo(path)
                extra.type = kind
                extra.linkname = 'package/dist/index.js'
                source = self.fixture(root, extra=extra)
                with self.assertRaises(ValueError):
                    release.prepare(source, root / 'out', '0.1.5')
                self.assertFalse((root / 'out').exists())
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.fixture(root, omit='LICENSE')
            with self.assertRaises(ValueError):
                release.prepare(source, root / 'out', '0.1.5')

    def test_rejects_allowed_path_symlink_and_wrong_identity(self):
        for wrong in ('link', 'name', 'version'):
            def change(member, data):
                if member.name == 'package/package.json':
                    if wrong == 'link':
                        member.type = tarfile.SYMTYPE
                        member.linkname = 'dist/index.js'
                    else:
                        metadata = json.loads(data)
                        metadata[wrong] = 'wrong'
                        data = json.dumps(metadata).encode()
                return member, data
            with self.subTest(wrong=wrong), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                source = self.fixture(root, changes=change)
                with self.assertRaises(ValueError):
                    release.prepare(source, root / 'out', '0.1.5')

    def test_manifest_and_incoming_fail_closed(self):
        for wrong in ('tamper', 'extra-manifest', 'extra-file', 'symlink'):
            with self.subTest(wrong=wrong), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                source = self.fixture(root)
                if wrong == 'tamper':
                    (source / 'freecoda-0.1.5.tgz').write_bytes(b'changed')
                elif wrong == 'extra-manifest':
                    with (source / 'SHA256SUMS').open('a') as stream:
                        stream.write('unexpected\n')
                elif wrong == 'extra-file':
                    (source / 'private.env').write_text('never publish')
                else:
                    archive = source / 'freecoda-0.1.5.tgz'
                    archive.rename(root / 'external')
                    archive.symlink_to(root / 'external')
                with self.assertRaises(ValueError):
                    release.prepare(source, root / 'out', '0.1.5')
                self.assertFalse((root / 'out').exists())

    def test_limits_version_and_existing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.fixture(root)
            for version in ('0.1.5-beta', '../x', '00.1.5'):
                with self.assertRaises(ValueError):
                    release.prepare(source, root / 'out', version)
            old_limit = release.MAX_EXPANDED
            try:
                release.MAX_EXPANDED = 1
                with self.assertRaises(ValueError):
                    release.prepare(source, root / 'out', '0.1.5')
            finally:
                release.MAX_EXPANDED = old_limit
            (root / 'out').mkdir()
            (root / 'out' / 'keep').write_text('preserved')
            with self.assertRaises(FileExistsError):
                release.prepare(source, root / 'out', '0.1.5')
            self.assertEqual((root / 'out' / 'keep').read_text(), 'preserved')


if __name__ == '__main__':
    unittest.main()
