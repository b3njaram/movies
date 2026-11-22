#!/usr/bin/env bash
# Update StreamHub: fetch the latest code from GitHub and rebuild the containers.
#   ./update.sh            normal update
#   FORCE=1 ./update.sh    skip the data-folder safety check
set -euo pipefail
cd "$(dirname "$0")"

D=docker
if ! docker info >/dev/null 2>&1; then D="sudo docker"; fi

echo "==> Getting the latest code"
git pull --ff-only

# Safety net: never silently switch a service to an empty data folder (it would look like all your
# Prowlarr indexers / accounts had vanished). Compare what is mounted now with what compose will use.
check_mount() {
  local container="$1" dest="$2" var="$3" current wanted
  current="$($D inspect "$container" --format "{{range .Mounts}}{{if eq .Destination \"$dest\"}}{{.Source}}{{end}}{{end}}" 2>/dev/null || true)"
  wanted="$($D compose config 2>/dev/null | awk -v dest="$dest" '$1=="source:" {s=$2} $1=="target:" && $2==dest {print s; exit}')"
  if [ -n "$current" ] && [ -n "$wanted" ] && [ "$current" != "$wanted" ]; then
    echo
    echo "STOP: '$container' is using    $current"
    echo "      but this update would use $wanted"
    echo "      Your data would look empty. To keep using the current folder, add this line to .env:"
    echo "        $var=$current"
    echo "      (If the change is intentional, run:  FORCE=1 ./update.sh)"
    exit 1
  fi
}
if [ "${FORCE:-0}" != "1" ]; then
  check_mount prowlarr /config PROWLARR_CONFIG_DIR
  check_mount torrserver /opt/ts/config TORRSERVER_CONFIG_DIR
fi

echo "==> Rebuilding and restarting"
$D compose up -d --build
$D image prune -f >/dev/null 2>&1 || true

echo "==> Done"
$D compose ps
