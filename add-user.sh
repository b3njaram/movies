#!/usr/bin/env bash
# Create a login (or reset its password):   ./add-user.sh <username> <password>
# There is no limit on how many accounts you create, and each account can have any number of profiles.
set -euo pipefail
D=docker
if ! docker info >/dev/null 2>&1; then D="sudo docker"; fi
exec $D exec -it streamhub-backend node create-user.js "$@"
