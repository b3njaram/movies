# Phase 9 — Resumable offline downloads and storage diagnostics

This update keeps the existing Express/React/SQLite/Docker Compose architecture. It does **not** change `.env`, `docker-compose.yml`, the SQLite location, or any Docker mounts. No database migration is necessary for these features.

## Device-local PWA downloads

- Browser-managed OPFS stores completed videos and incomplete video transfers separately. A user must explicitly start each download while online and keep the app in the foreground; paused transfers remain available in the **Offline** tab and in the standalone offline player.
- **Pause** uses a cancellation signal that closes the OPFS writer, preserving received bytes. **Resume** uses HTTP Range and `If-Range` when a validator is available. It validates the `Content-Range` start, declared total, and identity before appending; if a server ignores Range and returns a full `200` response, it restarts safely instead of duplicating bytes. Servers that cannot provide a stable validator may also restart from zero.
- Partial bytes do not appear as playable videos until completion. Network/authentication failure does not silently convert an incomplete transfer to a playable video. The 8 GB per-video limit remains.
- The device storage budget is selectable (2, 5, 10, 20, 40 GB), enforced when starting and receiving downloads. It also checks browser-reported quota, but the browser/OS may still reclaim the data. This is an *application budget*, not a promise of free disk space.
- Offline files are **not encrypted or bound to a StreamHub sign-in**. Every person with access to the same browser profile/storage can view them; online profile isolation does not apply to offline video. Avoid shared devices for private content. Real encrypted offline profiles need a separate design and cross-device testing before being marketed as secure.
- Downloads don't continue in the background after the browser is suspended. The PWA player still works without internet after an online installation of its updated service worker; offline downloads are per device.

## Read-only media audit

Administrators can open **Admin → Media storage audit → Scan storage**. It scans up to 1500 local files and hashes at most 150 duplicate-size candidates (first and last 64 KiB only) to identify *possible* duplicates, and compares indexed paths to disk to show missing files. This is advisory, not byte-for-byte proof of duplication; it does not modify or delete media. The result is cached for two minutes to avoid repeated disk scans. File names from the local media directory are only exposed to an unrestricted administrator.

## Validation and deployment

- `node --test backend/test/*.test.js frontend/test/*.test.js`
- Existing SQLite migration/recovery tests and full HTTP integration tests
- Playwright Chromium (`python tests/test_offline_browser.py`) exercises interrupted transfer, byte-accurate resumption, device budget, offline reload, and video playback in airplane mode. The browser E2E test runs in GitHub Actions because local execution may block loopback websites.
- Existing `.env`, SQLite and Docker mounts are preserved; use `bash scripts/safe-update.sh` from your existing server checkout after verifying the Git remote and backing up persistent data. Do not run `docker compose down -v`.

## Limitations

Real-device iPhone PWA persistence, Android background suspension and AirPlay/Chromecast receiver behavior are not proven by a Chromium test. The scan does not cover external mount paths; only the existing local-media directory under `data/app` is included. True encrypted offline profiles, seamless background downloads, and always-on disk alerts are separate future work.
