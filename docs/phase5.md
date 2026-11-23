# Phase 5 — Library metadata, embedded text subtitles and watch-party chat

This phase stays within **React + Express + SQLite + Docker Compose**. No `.env`, volume mount, network service, or data relocation is required. Persistent metadata and chat are stored in additive SQLite columns/tables in `data/app/streamhub.db`. Existing scans, downloads, profiles, and watch history are retained.

## Identify local files

1. Put media you own in the current `data/app/media/` folder.
2. Open **Community → Local media** as an administrator, and **Scan media folder**.
3. Select **Match up to 6 titles automatically**. StreamHub searches the existing TMDB connection; it only saves high-confidence, unambiguous title/year matches. Ambiguous or missing results stay unmatched and are revisited later. No automatic downloads occur.
4. Use **Match** on an individual file to pick a suggested movie/series, search again, or clear an incorrect mapping. Movie/TV types must match the local filename classification. To fix a mistaken TV/movie classification, rename the file and scan again.

TMDB identification is for artwork and metadata only. It does **not** change the physical filename, permission model, or individual playback URL, and it does not merge user watch history. Your TMDB API key is never exposed to the browser. Files without known ratings stay restricted to unrestricted adult profiles.

## Embedded text captions

Local media and saved library videos can now offer embedded **SRT/SubRip, ASS/SSA, WebVTT, mov_text** text tracks in the existing CC menu. FFprobe reads track metadata; FFmpeg converts a selected track into VTT temporarily when requested. No subtitle video re-encode or persistent duplicate is created. Both tools already ship in the backend image. Extraction is capped at 5 MiB, 30 seconds and two concurrent jobs. Subtitle endpoints require a valid unlocked profile and media ownership rules.

Bitmap subtitles (PGS/VobSub), OCR, subtitle-provider downloads and subtitle timing-offset editing are **not yet implemented**. For those, users can still load a personal `.srt` or `.vtt` file through the CC menu.

## Watch-party chat

Joined room members can exchange short text messages while the party runs. A message is at most 300 characters, messages are rate-limited, and each room retains at most 300 chat entries. Access is authenticated, checked against room membership and the active profile's age restriction. Messages disappear when the room expires or is deleted. There is no direct messaging outside watch parties or notification push service.

## Update and verification

1. Confirm the Mac mini's existing Git remote and status. Preserve any local customizations.
2. Back up `data/app` using the already provided recovery helper; also back up `.env` and external config mounts where required.
3. Verify all live Docker mount sources against `docker compose config` before starting.
4. Pull `main`, rebuild with `sudo docker compose up -d --build`, and inspect backend startup logs for migration errors.
5. Test old account sign-in, watch history, saved playback, one local scan/match, CC for a local MKV text track, and watch-party permissions. Re-run with two profiles to test isolation.

The GitHub checks cover unit tests, existing database migrations, API integration and the React production build. Physical Chromecast receivers and offline browser downloads are **outside this phase**; existing browser-native casting and device downloads are unchanged.
