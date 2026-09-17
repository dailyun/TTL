#!/usr/bin/env python3
"""Check or restore the pre-execution deployment; never overwrite execution history."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import tarfile


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='/opt/todotodolist')
    parser.add_argument('--backup', required=True, help='Pre-execution backup directory')
    parser.add_argument('--image', default='todotodolist:pre-execution-20260917')
    parser.add_argument('--apply', action='store_true', help='Stop the new services and restore the old app')
    args = parser.parse_args()
    root, backup = Path(args.root).resolve(), Path(args.backup).resolve()
    old_app = root / 'app.pre-execution-20260917'
    if not old_app.is_dir() or not (backup / '.env').is_file():
        raise SystemExit('Original application or private environment backup is missing; nothing changed.')
    with tarfile.open(backup / 'configuration-and-data.tar.gz') as archive:
        original_compose = archive.extractfile('docker-compose.yml').read()
    run('docker', 'image', 'inspect', args.image)
    if not args.apply:
        print(json.dumps({'ready': True, 'mode': 'check_only', 'data_will_be_retained': True}))
        return
    if not (root / 'app').is_symlink():
        raise SystemExit('Expected the release symlink; nothing changed.')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    recovery = root / 'backups' / ('before-rollback-' + stamp)
    recovery.mkdir(parents=True, mode=0o700)
    compose = root / 'docker-compose.yml'
    for name in ('docker-compose.yml', 'execution.env'):
        shutil.copy2(root / name, recovery / name)
    (recovery / 'release-path.txt').write_text(str((root / 'app').resolve()))
    run('docker', 'compose', '-f', str(compose), 'stop')
    # Capture all post-migration feedback after writers have stopped. Keep the live
    # directory in place too, including the newest Google refresh authorization.
    with tarfile.open(recovery / 'current-data.tar.gz', 'w:gz') as archive:
        archive.add(root / 'data', arcname='data')
    (recovery / 'current-data.tar.gz').chmod(0o600)
    run('docker', 'compose', '-f', str(compose), 'down')
    (root / 'app').unlink()
    (root / 'app').symlink_to(old_app)
    compose.write_bytes(original_compose)
    shutil.copy2(backup / '.env', root / '.env')
    (root / '.env').chmod(0o600)
    override = root / 'docker-compose.rollback.yml'
    override.write_text('services:\n  todotodolist:\n    image: ' + json.dumps(args.image) + '\n')
    run('docker', 'compose', '-f', str(compose), '-f', str(override), 'up', '-d', '--no-build')
    print(json.dumps({'restored': True, 'saved_new_state': str(recovery),
                      'next': 'Verify /api/health and login. New feedback remains in data/execution.json.'}))


if __name__ == '__main__':
    main()
