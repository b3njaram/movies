#!/usr/bin/env bash
# Explicit, guarded source update. No Docker volumes or .env files are deleted.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  echo 'Run this script as your normal account, NOT with sudo; it elevates only Docker operations.' >&2
  exit 1
fi
if docker info >/dev/null 2>&1; then PRIV=(); else PRIV=(sudo); fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo 'STOP: tracked source files have local modifications.' >&2; exit 1
fi
if [ "$(git remote get-url origin)" != 'https://github.com/b3njaram/movies.git' ] && \
   [ "$(git remote get-url origin)" != 'git@github.com:b3njaram/movies.git' ]; then
  echo 'STOP: this is not the expected b3njaram/movies checkout.' >&2; exit 1
fi
"${PRIV[@]}" python3 scripts/recovery.py inspect
old=$(git rev-parse HEAD)
backup_dir="$HOME/streamhub-backups"
mkdir -p "$backup_dir"
archive="$backup_dir/pre-update-$(date +%Y%m%d-%H%M%S).tar.gz"
"${PRIV[@]}" python3 scripts/recovery.py backup --output "$archive"
echo "Verified pre-update archive: $archive"

git pull --ff-only origin main
"${PRIV[@]}" python3 scripts/recovery.py inspect
if ! "${PRIV[@]}" docker compose up -d --build; then
  echo 'Build/start failed. Rolling code back to previous commit.' >&2
  git reset --hard "$old"
  "${PRIV[@]}" docker compose up -d --build || true
  exit 1
fi
# The web UI should answer locally. No account token is needed to check HTML.
port=$("${PRIV[@]}" docker compose port frontend 80 | awk -F: '{print $NF}' | tail -1)
if [ -n "$port" ] && command -v curl >/dev/null; then
  for i in {1..8}; do
    if curl --fail --silent --max-time 4 "http://127.0.0.1:$port/" >/dev/null; then
      echo "Update complete. Backup: $archive"; exit 0
    fi
    sleep 3
  done
  echo 'WARNING: Web UI did not answer; trying to roll back the source revision.' >&2
  git reset --hard "$old"
  "${PRIV[@]}" docker compose up -d --build || true
  exit 1
fi
echo "Containers started. Verify playback manually. Backup: $archive"
