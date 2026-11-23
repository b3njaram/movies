# Phase 7 — Episode tracking and alerts

No new containers, mounts, environment variables or accounts are required. StreamHub stores follows in an additive `tv_episode_follows` table in the **existing** `data/app/streamhub.db`. Notifications reuse Phase 6's per-profile notification table.

## How it works

1. Open a **TV show** and choose **Follow new episodes**. The active profile subscribes, and a **Following** row appears on Home.
2. StreamHub checks the series' TMDB airing metadata roughly every six hours while the backend runs. The checker wakes every ten minutes, and processes at most 40 due profiles per pass. It uses a one-hour TMDB cache, and does not run when TMDB is unconfigured.
3. Following sets a baseline to the most recently aired episode at that moment. Existing/older episodes do not produce notifications. If the latest aired season/episode number moves ahead, a single **New episode** alert is created (deduplicated per episode, per profile).
4. Click the notification bell to open that series. Unfollow from the series page to stop future alerts. Deleting a profile cascades its subscriptions.
5. Restricted profiles can only follow eligible rated series; checks honor current age restrictions. The same account's other profiles never receive those alerts.

TMDB air dates are **not** confirmations that an episode is available to stream, that your indexers have it, or that the episode is available in your country. TV specials are ignored, future-dated entries are ignored, and if multiple episodes aired between checks, the notification names the latest one. The scheduler only runs while the StreamHub backend is running, but catches up after it restarts. Older shows will not spam alerts on first follow.

## Deployment

Follow your standard verified backup + safe-update process (`scripts/safe-update.sh`) from the **existing checkout** after confirming the Git remote and no unexpected local changes. Do not overwrite your `.env`, move persistent volumes, or use `docker compose down -v`. After deployment, a followed TV show should appear on Home and the bell should show an alert only after a later episode airs.

## Offline mobile playback status

The current PWA caches its UI shell, **not movie files**. Its existing browser download button saves a file to the device but does **not** put the file in an indexed, offline StreamHub library. Offline playback inside the installed PWA is a separate feature that would need device-local encrypted or bounded video storage, a download manifest, HTTP Range handling via a Service Worker and quota management. iOS may evict website data and does not reliably download large files in the background. This release does not change offline playback behavior.
