# Phase 6: notifications, personal homepage and security hardening

This increment preserves **the same Express, React, SQLite, and Docker Compose architecture**. It does **not** change `.env`, `docker-compose.yml`, its bind mounts, usernames, passwords, or media files. Two additive SQLite tables are created at startup: `profile_notifications` and `profile_home_preferences`; both delete their rows when a profile is deleted.

## Notification bell

The bell in the top bar checks for notifications on the current unlocked profile. It updates when the app is visible, approximately every 45 seconds. Alerts are generated for:

- completed server-side downloads;
- failed server-side downloads; and
- administrator changes to a movie/TV request's status.

Opening an alert takes you to **Library** or **Community**, respectively. Alerts can be marked individually or all at once. There is no push service, email delivery, background notification daemon, or external key. Notifications are kept per profile with at most 120 stored entries; event keys deduplicate repeated status updates. Other profiles cannot read or mark your notifications.

## Your homepage

Home adds a **Hide watched movies** toggle, saved per profile in SQLite. It affects Home catalog rows, recommendations, and My List; completed movies remain discoverable in Search and other pages. A separate **Watch again** row displays recently completed movies and remains visible even when the hiding toggle is on. Completing one episode never hides an entire TV series.

Unwatched recommendations are deduplicated by TMDB ID and media type. Recommendations continue to use each profile's history and TMDB; no additional key or background model is required.

## Security and performance changes

- Removed the previous reflective, credentialed CORS middleware. The shipped React frontend and `/api` routes already share an origin through Nginx. Browser state-changing API requests with a mismatched `Origin` or cross-site Fetch Metadata header are rejected. Command-line clients without an Origin header still work.
- Express trusts forwarding headers only from loopback/link-local/private proxy hops. Login requests no longer use an unverified `CF-Connecting-IP` header for their limiter key.
- Login attempts are limited per IP and username, with a bounded, expiring attempt table. The server refuses excessively long login input.
- Concurrent requests for the same TMDB item share the same in-flight query rather than duplicating upstream calls.
- Automated tests check database upgrade safety, profile isolation, login/origin validation, and frontend filtering. Real simultaneous-viewer performance still needs checking on your Mac mini.

## Updating

Use the existing installation at `~/docker/movies/streamhub`. Read [Updates and Backups](updates-and-backups.md) and **verify the running Docker mounts before any rebuild**. Prefer your existing `scripts/safe-update.sh` guarded upgrade helper. After deployment, open the homepage and notification bell under two different profiles to confirm privacy.

No live server or data was modified by the GitHub commit. SQLite migrations run when the updated backend starts. As with prior versions, take a verified backup first.
