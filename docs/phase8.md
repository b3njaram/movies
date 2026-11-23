# Phase 8 — Offline viewing, Chromecast, push, subtitle controls, browser tests

This upgrade retains the existing React/Express/SQLite/Docker Compose architecture. **No change to `docker-compose.yml`, `.env`, or the three persistent mounts.** All new persistent server data is under the existing `data/app/` mount. Back up your installation using `scripts/safe-update.sh` before upgrading.

## Offline downloads in the PWA

1. While online and signed into StreamHub, open **Offline** or use **Save offline** in the player.
2. Select a saved local-library video (or an already-resolved video in the player). Keep the browser open while downloading. Streaming downloads are written incrementally to the browser's Origin Private File System (OPFS), not to the service worker's Cache Storage.
3. Visit **Offline → Open offline player** once while online, or open `/offline.html`. You may now use it with the phone in airplane mode. The offline player lists completed files, restores the local watch position, and deletes downloads on request.
4. Downloads are on **each phone separately**. This does not make the server available offline, and the page does not attempt to sign the user in when disconnected.

Important restrictions: a browser must support OPFS and secure contexts (HTTPS or loopback); downloads are limited to 8 GB each, are deliberately foreground-only, and interrupted downloads restart instead of resuming. Available quota varies with the device and browser. The operating system may evict browser storage. iOS PWA storage and background execution can be especially restrictive. Not every MKV/HEVC/DTS file decodes natively on iOS/Android—use an MP4/H.264/AAC source or a compatible server-produced copy. **Offline videos have no account sign-in gate on that device**, so anyone with access to the same browser/PWA storage can view them. Do not use the offline store on shared devices when this matters. Only download videos you have the right to access.

This PWA feature does not use background fetch or hidden transcoding. It also leaves the original browser **Download** button and the server-side **Save on server** queue untouched.

## Chromecast

The player retains browser-native Remote Playback/AirPlay. A **Cast** button also offers Google Cast's default receiver when viewing a locally saved **MP4/WebM** video. The backend issues a signed 6-hour URL bound to one video, account and profile. The receiver requests Range bytes without using login cookies. Disabling the account or removing the media immediately revokes access; expiration limits exposure if a URL is copied.

Requirements: Cast-enabled Chrome/compatible browser, Google Cast SDK availability, a receiver able to reach the StreamHub **HTTPS** address, and media codecs supported by the receiver. The signed URL is a bearer credential for that one file until expiration; don't share it or log its query string. This first version does not support direct Chromecast casting of arbitrary live torrents, MKV, cloud-protected/private LAN-only URLs, or advanced receiver subtitle selection. Streaming via Cloudflare may be subject to its large-video policies; consider Tailscale or another permitted direct route instead. It is not a guarantee that every Chromecast device or cloud tunnel will work.

## Opt-in push notifications

From the notification bell choose **Enable push** and allow the browser permission prompt. Mobile iPhone/iPad web push requires the app to be installed on the home screen, iOS 16.4+ and appropriate notification settings; Android/browser support varies. Push works over HTTPS. Use **Disable push** to unsubscribe. New server download and episode-tracking events use the same private SQLite notifications as before; push delivery is best effort.

VAPID signing keys are generated once under `data/app/push-vapid-keys.json` (mode 0600). No external API key is needed and `.env` is unchanged. The database stores only subscriptions from vetted push endpoints. For privacy, the lock-screen payload says **StreamHub update** without private title or episode text. Push is not guaranteed if device settings, network, or providers block delivery. The device may continue to receive push for the subscribed profile after switching website profiles; disable push on shared devices.

## Subtitles

The existing CC picker adds a **-0.5s/+0.5s** timing adjustment (bounded to ±20s), Reset, and caption font-size controls. Timings are recalculated from the original VTT cues, so repeated adjustments do not compound. Native or bitmap subtitle tracks that do not expose editable cues may ignore the timing option. Existing SRT/VTT uploads and embedded text-track extraction remain supported. Online subtitle-provider integration and PGS/OCR are not part of this phase.

## Validation

- `node --test backend/test/*.test.js frontend/test/*.test.js` — source ranking, casting-token expiry and tampering, offline shell isolation, subtitle offsets and earlier regressions.
- `node --test backend/integration/*.test.js` — real SQLite and HTTP access-control checks (run after installing backend npm dependencies).
- Database migration and backup tests, unchanged Compose mount check, backend syntax checks, frontend Vite production build.
- `python tests/test_offline_browser.py` — Playwright Chromium: install worker, download a small MP4, verify forbidden response cannot be saved, cut network connectivity, reload offline page, and play the stored Blob. GitHub Actions installs Chromium and runs the test. Physical Chromecast receivers, iOS PWA background behavior, and push delivery to real devices must be tested on those devices.

## Safe deployment

1. Verify `git remote -v`, `git status --short`, and current container bind mounts.
2. Back up the current data and `.env` outside your Git checkout with `scripts/recovery.py backup` or the guarded updater.
3. Deploy with `bash scripts/safe-update.sh` from the original installation folder.
4. Check `sudo docker compose ps` and backend logs, then test login, current watch progress, and the new Offline screen on an HTTPS connection.
5. If a browser has cached the previous service worker, close and reopen the installed PWA; older cached video bytes are intentionally not touched.

No user data, `data/`, `.env`, or signing keys are committed to GitHub.
