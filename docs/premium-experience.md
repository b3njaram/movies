# StreamHub Phase 2 — Premium experience

This release adds TV remote navigation, browser-native casting, manual skip markers, scrub previews, Discover filters, viewing-history recommendations, and PIN/age restrictions. The original `.env`, Docker Compose, volume mounts and user/watch data remain unchanged.

## Updating safely

Use your **existing** StreamHub directory. Check the Git remote, back up `data/app` while the backend is stopped, verify the three existing Docker bind mounts, then run `git pull --ff-only origin main` and `sudo docker compose up -d --build`. **Never** run `docker compose down -v` to update. The additive SQLite migration adds `profiles.pin_hash`, `profiles.pin_version`, `profiles.max_age`, and a `skip_markers` table. Older Kids profiles default to age 10; all others remain unrestricted.

## PINs and parental restrictions

From **Manage Profiles** set a maximum content age, and optionally add a 4–8-digit PIN. Setting/removing a PIN, relaxing an existing age limit, deleting a profile, and creating a more-permissive profile require the account password. When multiple age limits exist, switching to a more-permissive unpinned profile requires the account password. PIN-protected profiles prompt for the PIN when selected. PINs are stored as password hashes, and profile access uses a 12-hour signed HttpOnly cookie.

Catalog cards, searches, source lookup, actual stream requests and video proxy access enforce these restrictions. Unrated or uncertified titles fail closed for restricted profiles; age ratings are sourced from TMDB's US certifications and may be incomplete or inaccurate. **Kids must not know the account password.** Directly accessible Prowlarr/TorrServer instances are outside the scope of these controls. PINs are separate from the account login password.

## Remote control and casting

Enable **TV remote mode** in the profile menu, or let a recognized TV browser enable it automatically. Arrows navigate visible controls, Enter selects, and Back returns. Player left/right arrows seek; Down focuses the player toolbar. Use **Cast / AirPlay** in the player when the browser exposes the native Remote Playback or WebKit picker APIs. Casting requires compatible receivers, network reachability, and support for authenticated media URLs. **This is not a custom Chromecast receiver**; some receivers cannot play cookie-protected streams.

## Skip intro/credits

While watching a title choose **Skip markers**. Mark intro start, then intro end; optionally mark credits start. A manual Skip Intro/Credits button appears at the selected times. Markers are saved per-profile and per-episode (or movie). There is no automatic content analysis or auto-skip.

## Timeline thumbnails

Hover over the progress bar to show low-resolution scene previews where source seeking works. Frames are generated on demand using the existing ffmpeg inside the backend container, limited to one generator at a time and a 12-second deadline. Up to 200 small JPEGs are cached under the existing `data/app/previews` bind mount. Slow or seedless torrents may show time-only previews instead. Playback works even when thumbnail generation fails.

## Discover and recommendations

The **Discover** page supports movie/series, genre, year, rating and sort filters. The **Recommended for you** row derives a genre from the *active profile's* watch progress and My List, then looks for related TMDB titles. It needs no new keys or external recommendation service. Restricted profiles only receive age-verified results.

## Validation

GitHub Actions runs pure JavaScript unit tests, a legacy-SQLite compatibility test, backend syntax checks and the Vite build. Physical TV receivers, AirPlay, peer availability and playback on your Mac mini require follow-up tests on those devices.
