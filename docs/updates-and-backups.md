# StreamHub: safe updates, backups, restore and rollback

StreamHub runs under `~/docker/movies/streamhub` on the existing Mac mini. Do **not** move the installation or recreate `.env`, `streamhub.db`, or the Docker volumes when updating. **Never run `docker compose down -v` or `git clean -fdx`.**

## Update checklist

1. `cd ~/docker/movies/streamhub; git remote -v; git status --short` — confirm the checkout is `b3njaram/movies` and there are no unexpected local changes.
2. `sudo docker inspect streamhub-backend prowlarr torrserver --format '{{.Name}} {{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'` — record the live bind mounts.
3. `sudo python3 scripts/recovery.py inspect` — confirm Compose matches the live backend, Prowlarr, and TorrServer data mounts. Any mismatch is a **stop** condition, not a reason to create empty folders.
4. Take and **verify** a backup using the command below. Keep a copy on a different disk or machine.
5. `git pull --ff-only origin main; sudo python3 scripts/recovery.py inspect` — verify mounts **again** after the pull.
6. `sudo docker compose up -d --build; sudo docker compose ps; sudo docker compose logs --tail=100 backend frontend`.
7. Sign in, switch profiles, play a permitted movie, resume progress, check downloads, and confirm Prowlarr/TorrServer settings. Check Community and Settings if upgrading to Phase 4.

If your user can run Docker without sudo, omit `sudo`. An optional guarded update helper, `bash scripts/safe-update.sh`, performs a verified pre-update archive, checks the Git remote/mounts, rebuilds, and attempts **code rollback only** when startup fails. Its rollback cannot undo a database migration; test restoring the backup separately.

## Back up all configuration, database, and optionally media

Backups must be kept **outside** the repository and all Docker data mounts. They contain secrets (`.env`, Prowlarr API keys, user password hashes). Do not put them into GitHub or share them publicly.

```bash
cd ~/docker/movies/streamhub
sudo python3 scripts/recovery.py inspect
sudo python3 scripts/recovery.py backup --output "$HOME/streamhub-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
```

The backup tool reads **resolved Docker Compose bind mount sources** and checks the corresponding running containers. It briefly stops backend, Prowlarr and TorrServer to capture consistent settings, then starts them again. It saves the existing SQLite database, profiles/watch data, `.env`, Prowlarr configuration, and TorrServer settings. It does not edit any source files or `.env`.

The default backup excludes the possibly huge `data/app/library/` (queued/downloaded videos) and `data/app/media/` (imported videos), while keeping their database metadata. To back up video bytes too, add **`--include-media`**. If you exclude video bytes, a restore deliberately preserves the existing on-disk videos. To recover videos after a disk failure, a **full media backup** or an independent copy is required.

```bash
sudo python3 scripts/recovery.py backup --include-media --output "$HOME/streamhub-full-$(date +%Y%m%d-%H%M%S).tar.gz"
sudo python3 scripts/recovery.py verify --archive /path/to/streamhub-backup.tar.gz
```

For an encrypted off-device copy, use GnuPG's symmetric authenticated encryption (GPG prompts for a password):

```bash
gpg --symmetric --cipher-algo AES256 --output streamhub-backup.tar.gz.gpg streamhub-backup.tar.gz
# Test the encrypted file on another device before removing any unencrypted copy.
# Decryption: gpg --decrypt --output streamhub-backup.tar.gz streamhub-backup.tar.gz.gpg
```

Transfer the encrypted file to another disk/computer. Do not rely on on-server backups alone. GPG encryption is **not** automatic and requires GnuPG installed on the host.

## Recovery and dry run

1. Verify your `.env` exists; the **restore tool preserves it by default**.
2. Confirm the archive was generated from the **same data-mount paths**. Moving to a different host/path requires an administrator-guided migration, not blind restore.
3. Run the dry run, which **never writes data**:

```bash
sudo python3 scripts/recovery.py verify --archive /path/to/archive.tar.gz
sudo python3 scripts/recovery.py restore --archive /path/to/archive.tar.gz
```

4. Only after inspecting the output, explicitly authorize restoration:

```bash
sudo python3 scripts/recovery.py restore --archive /path/to/archive.tar.gz --apply --confirm RESTORE
```

This stops the three services, extracts only validated archive paths, moves the prior data to a timestamped rollback directory **outside the project**, puts restored data at the **same mounts**, and restarts the services. It preserves existing videos for archives created without `--include-media`. To also restore the private `.env`, add `--restore-env` deliberately. Never delete the timestamped rollback directory until you have checked account login, passwords, watch progress, playlists, TorrServer, Prowlarr, and stored video playback.

**Important:** This helper must run on a live host with Python 3.9+ and Docker Compose. Actual restore behavior should be tested first with a non-production copy. It does not back up media files located outside the configured mounts or external service storage not declared in Compose.

## Rollback

If only a new frontend/backend release fails but the database is healthy, return to the prior source revision and rebuild:

```bash
cd ~/docker/movies/streamhub
git log --oneline -5
# Only on a clean checkout, with a verified backup:
git checkout <previous-commit> -- backend frontend
sudo docker compose up -d --build
```

For database corruption or incompatible migrations, use the **verified restore** procedure. Always stop backend writes before copying a SQLite database, or use SQLite's online backup API; do not copy a live WAL-mode `.db` file without its WAL files. SQLite backup snapshots generated by the web admin cover the **database only**, not `.env`, other services or downloaded media.
