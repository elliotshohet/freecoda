import base64, hashlib, os, subprocess, sys, tempfile, unittest
from pathlib import Path
import yaml

SCRIPT = Path(__file__).with_name('prepare-desktop.py').resolve()
class ReleaseAssets(unittest.TestCase):
    def fixture(self, root):
        source=root/'incoming'
        for platform,arch,exts,feed in [('linux','x64',['.AppImage','.deb'],'latest-linux.yml'),('win','x64',['.exe'],'latest.yml'),('mac','x64',['.dmg','.zip'],'latest-mac.yml'),('mac','arm64',['.dmg','.zip'],'latest-mac.yml')]:
            directory=source/f'{platform}-{arch}'; directory.mkdir(parents=True)
            files=[]; checksums=[]
            for ext in exts:
                target_arch = ('amd64' if ext == '.deb' else 'x86_64') if platform == 'linux' else arch
                name=f'Freecoda-0.1.0-{platform}-{target_arch}{ext}'; data=name.encode()
                (directory/name).write_bytes(data)
                checksums.append(f'{hashlib.sha256(data).hexdigest()}  {name}')
                files.append({'url':name,'sha512':base64.b64encode(hashlib.sha512(data).digest()).decode(),'size':len(data)})
            (directory/feed).write_text(yaml.safe_dump({'version':'0.1.0','files':files,'path':files[-1]['url'],'sha512':files[-1]['sha512']}))
            (directory/'SHA256SUMS.txt').write_text('\n'.join(checksums))
            (directory/'source.ts').write_text('PRIVATE SOURCE')
        return source
    def run_prepare(self, source, output):
        return subprocess.run([sys.executable,str(SCRIPT),str(source),str(output)],env={**os.environ,'RELEASE_VERSION':'0.1.0'},capture_output=True)
    def test_merges_architectures_excludes_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source=self.fixture(root); output=root/'public'
            self.assertEqual(self.run_prepare(source,output).returncode,0)
            feed=yaml.safe_load((output/'latest-mac.yml').read_text())
            self.assertEqual(len(feed['files']),4)
            self.assertTrue(any('arm64.zip' in f['url'] for f in feed['files']))
            self.assertTrue(any('x64.zip' in f['url'] for f in feed['files']))
            self.assertFalse((output/'source.ts').exists())
    def test_rejects_tampered_installer(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source=self.fixture(root)
            (source/'win-x64'/'Freecoda-0.1.0-win-x64.exe').write_text('tampered')
            self.assertNotEqual(self.run_prepare(source,root/'public').returncode,0)
    def test_rejects_traversal_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source=self.fixture(root); feed=source/'win-x64'/'latest.yml'
            data=yaml.safe_load(feed.read_text()); data['files'][0]['url']='../secret'; feed.write_text(yaml.safe_dump(data))
            self.assertNotEqual(self.run_prepare(source,root/'public').returncode,0)
if __name__=='__main__': unittest.main()
