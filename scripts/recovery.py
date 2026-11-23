#!/usr/bin/env python3
"""Host-side StreamHub backup, verification, and opt-in restore.

Uses the active Docker Compose bind sources, not guessed relative paths.
Does not mutate .env or data except during an explicit confirmed restore.
Requires Python 3.9+ and Docker Compose on the host.
"""
import argparse
import contextlib
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import tempfile

PROJECT = Path(__file__).resolve().parents[1]
TARGETS = {'app': '/app/data', 'prowlarr': '/config', 'torrserver': '/opt/ts/config'}
SERVICES = {'app': 'backend', 'prowlarr': 'prowlarr', 'torrserver': 'torrserver'}
MAGIC = 'streamhub-recovery-v1'


def command(*args, capture=True):
    return subprocess.run(args, cwd=PROJECT, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def mounts():
    cfg = json.loads(command('docker', 'compose', 'config', '--format', 'json'))
    paths = {}
    for name, service in SERVICES.items():
        for volume in cfg['services'][service].get('volumes', []):
            if volume.get('target') == TARGETS[name]:
                if volume.get('type') != 'bind':
                    raise RuntimeError(f'{service} must use its current bind mount')
                paths[name] = Path(volume['source']).resolve()
                break
        if name not in paths:
            raise RuntimeError(f'No mount for {service} at {TARGETS[name]}')
    paths['env'] = PROJECT / '.env'
    return paths


def check_running(paths):
    for name in SERVICES:
        container = {'app': 'streamhub-backend', 'prowlarr': 'prowlarr', 'torrserver': 'torrserver'}[name]
        try:
            out = command('docker', 'inspect', container, '--format',
                          '{{range .Mounts}}{{println .Source "::" .Destination}}{{end}}')
        except subprocess.CalledProcessError:
            # Fresh installs may not have running containers yet.
            continue
        mounted = {d.strip(): Path(s.strip()).resolve() for s,d in
                   (line.split('::', 1) for line in out.splitlines() if '::' in line)}
        if mounted.get(TARGETS[name]) != paths[name]:
            raise RuntimeError(f'{container} uses {mounted.get(TARGETS[name])}, '
                               f'but Compose would use {paths[name]}; refusing')


def safe_output(file):
    file = Path(file).expanduser().resolve()
    protected = [PROJECT, *[p for key,p in mounts().items() if key != 'env']]
    if any(file == root or root in file.parents for root in protected):
        raise ValueError('Backup destination must be outside the source repository and all data mounts')
    return file


def include_tar(tar, paths, include_media):
    file_count = 0
    for name in ('app', 'prowlarr', 'torrserver', 'env'):
        root = paths[name]
        if not root.exists():
            if name == 'env':
                raise RuntimeError('The private .env file is missing; refusing incomplete backup')
            raise RuntimeError(f'Required data source is missing: {root}')
        def filter_item(info):
            nonlocal file_count
            if not include_media and name == 'app' and any(
                info.name == 'app/' + folder or info.name.startswith('app/' + folder + '/')
                for folder in ('library', 'media')):
                return None
            if info.issym() or info.islnk() or info.isdev() or info.isfifo():
                raise RuntimeError(f'Unsafe file type in backup: {info.name}')
            file_count += 1
            return info
        tar.add(root, arcname=name, recursive=True, filter=filter_item)
    return file_count


def backup(dest, include_media=False):
    paths = mounts()
    check_running(paths)
    dest = safe_output(dest)
    if dest.exists():
        raise FileExistsError(f'Backup already exists: {dest}')
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(dest.parent, dest.parent.stat().st_mode & 0o777 | 0o700)
    temp = dest.with_name(dest.name + '.incomplete')
    old_umask = os.umask(0o077)
    stopped = False
    try:
        # Stop writers so metadata and configuration files are consistent.
        command('docker', 'compose', 'stop', 'backend', 'prowlarr', 'torrserver', capture=False)
        stopped = True
        with tarfile.open(temp, 'w:gz') as archive:
            count = include_tar(archive, paths, include_media)
            meta = {
                'format': MAGIC,
                'created': dt.datetime.now(dt.timezone.utc).isoformat(),
                'include_media': bool(include_media),
                'mounts': {name: str(paths[name]) for name in SERVICES},
                'files': count,
            }
            raw = json.dumps(meta, indent=2).encode()
            info = tarfile.TarInfo('backup-manifest.json')
            info.size, info.mode = len(raw), 0o600
            archive.addfile(info, io.BytesIO(raw))
        temp.replace(dest)
    finally:
        if stopped:
            command('docker', 'compose', 'start', 'prowlarr', 'torrserver', 'backend', capture=False)
        with contextlib.suppress(FileNotFoundError):
            temp.unlink()
        os.umask(old_umask)
    verify(dest)
    print(f'Backup verified: {dest} ({dest.stat().st_size:,} bytes)')
    if not include_media:
        print('Local video libraries (library/ and media/) excluded. Use --include-media for a full media backup.')
    print('Copy this archive to a second disk or computer; on-server backups alone are not disaster recovery.')


def archive_members(archive):
    seen, manifest = set(), None
    entries = archive.getmembers()
    if len(entries) > 200000:
        raise ValueError('Too many archive entries')
    for m in entries:
        p = PurePosixPath(m.name)
        if m.name in seen or p.is_absolute() or '..' in p.parts or '\\' in m.name:
            raise ValueError(f'Unsafe or duplicate archive entry: {m.name}')
        seen.add(m.name)
        if m.issym() or m.islnk() or m.isdev() or m.isfifo():
            raise ValueError(f'Unsafe archive file: {m.name}')
        if p.parts[0] not in ('app', 'prowlarr', 'torrserver', 'env', 'backup-manifest.json'):
            raise ValueError(f'Unexpected archive member: {m.name}')
        if m.name == 'backup-manifest.json':
            if not m.isfile() or m.size > 16384:
                raise ValueError('Invalid manifest')
            manifest = json.load(archive.extractfile(m))
    if not manifest or manifest.get('format') != MAGIC:
        raise ValueError('This is not a StreamHub recovery archive')
    if not {'env', 'app', 'prowlarr', 'torrserver'}.issubset(seen):
        raise ValueError('Backup is missing required data')
    return entries, manifest


def verify(file):
    with tarfile.open(file, 'r:gz') as archive:
        entries, manifest = archive_members(archive)
        # Read all content, not only headers: catches truncated/corrupt archives.
        for m in entries:
            if m.isfile() and m.name != 'backup-manifest.json':
                with archive.extractfile(m) as stream:
                    while stream.read(1024 * 1024):
                        pass
    print(f"Verified archive from {manifest['created']} ({len(entries)} entries)")
    return manifest


def restore(file, apply=False, confirm='', restore_env=False):
    manifest = verify(file)
    paths = mounts()
    check_running(paths)
    for name in SERVICES:
        if str(paths[name]) != manifest['mounts'][name]:
            raise RuntimeError(f'Mount changed for {name}. Archive: {manifest["mounts"][name]}; now: {paths[name]}')
    print('Restore targets:')
    for name, target in paths.items():
        print(f'  {name}: {target}' + (' (preserved by default)' if name == 'env' else ''))
    if not apply:
        print('DRY RUN ONLY. Run with --apply --confirm RESTORE to replace current mounted data.')
        return
    if confirm != 'RESTORE':
        raise ValueError('Explicit --confirm RESTORE is required')
    # The snapshot of the old state is made outside the data mount BEFORE changing anything.
    rollback = safe_output(PROJECT.parent / ('streamhub-pre-restore-' + dt.datetime.now().strftime('%Y%m%d-%H%M%S')))
    rollback.mkdir(mode=0o700)
    command('docker', 'compose', 'stop', 'backend', 'prowlarr', 'torrserver', capture=False)
    replaced = []
    try:
        with tarfile.open(file, 'r:gz') as archive:
            entries, _ = archive_members(archive)
            with tempfile.TemporaryDirectory(prefix='streamhub-restore-', dir=rollback) as d:
                # Controlled extraction: archive path already checked; reject links.
                for m in entries:
                    if m.name == 'backup-manifest.json':
                        continue
                    target = Path(d).joinpath(*PurePosixPath(m.name).parts)
                    if m.isdir():
                        target.mkdir(parents=True, exist_ok=True)
                    elif m.isfile():
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with archive.extractfile(m) as s, target.open('wb') as out:
                            shutil.copyfileobj(s, out)
                        target.chmod(m.mode & 0o777)
                for name in ('app', 'prowlarr', 'torrserver', 'env'):
                    if name == 'env' and not restore_env:
                        continue
                    src, target = Path(d) / name, paths[name]
                    previous = rollback / name
                    if target.exists():
                        shutil.move(str(target), str(previous))
                    replaced.append((target, previous))
                    shutil.move(str(src), str(target))
                    if name == 'app' and not manifest['include_media']:
                        # A database-only backup must never erase videos still on disk.
                        for folder in ('library', 'media'):
                            preserved = previous / folder
                            if preserved.exists():
                                if (target / folder).exists():
                                    raise RuntimeError(f'Unexpected {folder} in media-free snapshot')
                                shutil.move(str(preserved),str(target / folder))
    except Exception:
        for target, previous in reversed(replaced):
            if target.name == 'app' and not manifest['include_media'] and target.is_dir() and previous.is_dir():
                for folder in ('library','media'):
                    if (target / folder).exists():
                        shutil.move(str(target / folder),str(previous / folder))
            if target.is_dir():
                shutil.rmtree(target)
            elif target.exists():
                target.unlink()
            if previous.exists():
                shutil.move(str(previous), str(target))
        raise
    finally:
        command('docker', 'compose', 'start', 'prowlarr', 'torrserver', 'backend', capture=False)
    print(f'Restored mounted data. Pre-restore copies: {rollback}')
    if not manifest['include_media']:
        print('Local video files were kept in place; this archive does not contain their bytes.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('inspect')
    b = sub.add_parser('backup'); b.add_argument('--output', required=True); b.add_argument('--include-media', action='store_true')
    v = sub.add_parser('verify'); v.add_argument('--archive', required=True)
    r = sub.add_parser('restore'); r.add_argument('--archive', required=True); r.add_argument('--apply', action='store_true'); r.add_argument('--confirm', default=''); r.add_argument('--restore-env', action='store_true')
    args = parser.parse_args()
    if args.action == 'inspect':
        p = mounts(); check_running(p)
        for name, value in p.items(): print(name, value)
    elif args.action == 'backup': backup(args.output, args.include_media)
    elif args.action == 'verify': verify(args.archive)
    elif args.action == 'restore': restore(args.archive, args.apply, args.confirm, args.restore_env)


if __name__ == '__main__':
    try: main()
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError, tarfile.TarError) as exc:
        sys.exit(f'ERROR: {exc}')
