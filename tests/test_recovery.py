"""Offline backup verification tests; no Docker daemon or .env needed."""
import io
import importlib.util
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('recovery',str(Path(__file__).resolve().parents[1]/'scripts/recovery.py'))
recovery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recovery)


def archive(path, extra=None):
    with tarfile.open(path,'w:gz') as t:
        meta=json.dumps({'format':recovery.MAGIC,'created':'2026-01-01','include_media':False,'mounts':{},'files':3}).encode()
        i=tarfile.TarInfo('backup-manifest.json');i.size=len(meta);t.addfile(i,io.BytesIO(meta))
        for name in ['app','prowlarr','torrserver']:
            i=tarfile.TarInfo(name);i.type=tarfile.DIRTYPE;t.addfile(i)
        value=b'STREAMHUB-TEST';i=tarfile.TarInfo('env');i.size=len(value);t.addfile(i,io.BytesIO(value))
        if extra:
            i=tarfile.TarInfo(extra);i.size=2;t.addfile(i,io.BytesIO(b'xx'))

class BackupTests(unittest.TestCase):
    def test_valid_archive(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'okay.tar.gz';archive(p)
            self.assertEqual(recovery.verify(p)['format'],recovery.MAGIC)
    def test_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'bad.tar.gz';archive(p,'app/../danger.txt')
            with self.assertRaises(ValueError):recovery.verify(p)
    def test_rejects_unexpected_entries(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'bad.tar.gz';archive(p,'etc/passwd')
            with self.assertRaises(ValueError):recovery.verify(p)
    def test_requires_manifest_and_all_mounts(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'bad.tar.gz'
            with tarfile.open(p,'w:gz') as t:
                i=tarfile.TarInfo('app');i.type=tarfile.DIRTYPE;t.addfile(i)
            with self.assertRaises(ValueError):recovery.verify(p)


# Tests for the host paths with Docker subprocess calls mocked. They run only
# when this file is invoked through unittest discovery (not when executed as a script).
class RestoreSemantics(unittest.TestCase):
    def test_restore_keeps_existing_video_if_snapshot_excludes_media(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(prefix='sh-p4-') as root:
            p=Path(root)
            project=p/'project';project.mkdir()
            live=p/'live';live.mkdir()
            paths={'app':live/'app','prowlarr':live/'prowlarr','torrserver':live/'torrserver','env':live/'.env'}
            for k in ['app','prowlarr','torrserver']:paths[k].mkdir()
            (paths['app']/'library').mkdir();(paths['app']/'library'/'movie.mp4').write_bytes(b'original video')
            (paths['app']/'media').mkdir();(paths['app']/'media'/'own.mkv').write_bytes(b'own video')
            (paths['app']/'streamhub.db').write_bytes(b'old db')
            paths['env'].write_text('PRIVATE_KEY=DO_NOT_CHANGE\n')
            archive=p/'recovery.tar.gz'
            with patch.object(recovery,'PROJECT',project),patch.object(recovery,'mounts',return_value=paths),\
                 patch.object(recovery,'check_running',return_value=None),patch.object(recovery,'command',return_value=''):
                recovery.backup(archive,include_media=False)
                (paths['app']/'streamhub.db').write_bytes(b'changed database')
                (paths['app']/'media'/'own.mkv').write_bytes(b'newer existing video')
                paths['env'].write_text('NEW_KEY=STILL_LOCAL\n')
                recovery.restore(archive,apply=True,confirm='RESTORE')
                self.assertEqual((paths['app']/'streamhub.db').read_bytes(),b'old db')
                self.assertEqual((paths['app']/'library'/'movie.mp4').read_bytes(),b'original video')
                self.assertEqual((paths['app']/'media'/'own.mkv').read_bytes(),b'newer existing video')
                self.assertEqual(paths['env'].read_text(),'NEW_KEY=STILL_LOCAL\n')

if __name__=="__main__":unittest.main()
