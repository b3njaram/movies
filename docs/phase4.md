# Phase 4: StreamHub reliability and community

This release retains the existing Express + React + SQLite + Docker Compose design, `data/app` database, all environment variables, and the same three data mounts. All new tables are created with `CREATE TABLE IF NOT EXISTS`. No new API keys or services are required.

## Playback recovery

If a video has played but stops making progress for ~22 seconds while playing, the player attempts **one reconnect on the same source** and restores the watch position. If no progress appears after another ~28 seconds, an automatically selected source may be marked failed and replaced by another. A **manually selected source, local file, or exhausted fallback** is never silently replaced. Handoff, regular resume, and all existing audio/video conversion settings remain available.

## Collections

Community → Collections: create named collections, find catalog titles, and add or remove titles. Up to 50 collections per profile, 300 titles each. Lists are profile-private, and restricted profiles see only titles allowed by their current age rating.

## Requests

Community → Requests: submit a title request for an administrator. Requests have a status of pending, approved, available or declined. The administrator can change statuses from the Community page. **Requests do not automatically download media**; admins decide what to make available. Kids profiles must use a rated TMDB catalog title.

## Watch parties

Community → Watch parties: search for a TMDB title and create a room, or join with the 12-character code. Maximum 8 profiles per room; rooms expire after 8 hours. Only the host can update the shared playback clock. Every client resolves and streams the title **independently** using its own authorized profile and source. A room never grants access to a title that violates parental controls. Browsers may need a tap to begin playback; source loading delays cause temporary drift. This is polling-based synchronization, not a native Chromecast receiver or a real-time chat.

## Local-media folder

Copy your own movie/TV files to `~/docker/movies/streamhub/data/app/media/` (equivalently `/app/data/media/` inside the backend container). Community → Local media → **Scan media folder** (admin) indexes supported local files (`mp4`, `mkv`, `m4v`, `webm`, `mov`) up to three levels deep. Files are played directly with authenticated HTTP range requests; no external mount, torrent or extra network service is used. The scanner guesses the movie name, year, and `S01E01` episodes from filenames. It **does not yet download posters or match TMDB IDs**, and unrated local files are accessible only through unrestricted adult profiles. Local media is not copied into Git.

## Recovery and deployment

Read [Updates and Backups](updates-and-backups.md) before updating. The `scripts/recovery.py` helper supports inspect, backup, verify, dry-run restore and explicit confirmed restore, including external Prowlarr/TorrServer config bind mounts. The existing automatic SQLite snapshots from Phase 3 continue as before.
