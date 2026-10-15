# StreamHub

A self-hosted, Netflix-style streaming front end for **your own** Prowlarr indexers and TorrServer.
No subscriptions, no Debrid — everything runs on your machine.

## What you get

- **Sign-in screen** and **"Who's watching?" profiles** (up to 5 per account, avatars, Kids profiles, manage / edit / delete).
- **Netflix-style home**: auto-playing trailer billboard, hover-expanding cards, scrolling rows, *Continue Watching* with progress bars, *Up next* for the following episode, *My List*.
- **Title pages**: synopsis, cast, seasons and episodes (with per-episode progress and "Watched" marks), *More Like This*.
- **One-click Play**: StreamHub searches your indexers, ranks the releases (browser-friendly H.264/AAC first, CAMs and wrong-year remakes filtered out), connects through TorrServer and starts streaming. If a source is dead it tries the next one automatically. A **Sources** button lets you pick a specific release yourself.
- **Netflix-style player**: auto-hiding controls, scrubbing with time preview, ±10s, volume, playback speed, full screen, keyboard shortcuts (`Space`/`K`, `←` `→`, `↑` `↓`, `M`, `F`, `Esc`), resume where you left off, auto-play of the next episode.
- **Per-profile** watch history and My List, kept in a small SQLite file.
- Works the same on desktop and phone, on your LAN or through a Cloudflare Tunnel.

## One-time setup: the catalog (TMDB)

Posters, trailers and descriptions come from The Movie Database. It is **free**:

1. Create an account at <https://www.themoviedb.org>.
2. *Settings → API* → copy the **API Key** (the short one).
3. Add it to the `.env` file that sits next to `docker-compose.yml`:

```
TMDB_API_KEY=your_key_here
```

Your existing `PROWLARR_API_KEY` and `JWT_SECRET` lines stay exactly as they are.
Without a TMDB key the app still works, but only through the search box (indexer results) — the home page shows a setup card.

## Upgrading an existing install (safe, step by step)

Your accounts and watch history live in `data/app/streamhub.db` and are migrated automatically (your old history shows up under your first profile). Prowlarr/TorrServer data is not touched.

```bash
cd ~/docker/movies/streamhub

# 0. make sure you own the folder (avoids "Permission denied")
sudo chown -R "$USER":"$USER" .

# 1. back up the database
cp -r data/app "data/app.backup-$(date +%F)"

# 2. replace ONLY the code folders (your .env and data/ are not touched)
rm -rf backend frontend
unzip -o ~/docker/streamhub-v2.zip -d ~/docker/_new
cp -r ~/docker/_new/streamhub/backend  ./backend
cp -r ~/docker/_new/streamhub/frontend ./frontend
rm -rf ~/docker/_new

# 3. add ONE line to the backend's environment (keeps all your other settings)
grep -q TMDB_API_KEY docker-compose.yml || \
  sed -i 's|^\(\s*\)- DB_PATH=/app/data/streamhub.db|&\n\1- TMDB_API_KEY=${TMDB_API_KEY:-}|' docker-compose.yml

# 4. add your TMDB key to .env (see above), then rebuild
nano .env
docker compose up -d --build
```

Then open the site and **hard-refresh** (Ctrl+Shift+R).

### Accounts

```bash
docker exec -it streamhub-backend node create-user.js <username> <password>
```

Run it again with an existing username to reset that password.

## Troubleshooting

**A red banner says Prowlarr rejected the API key.**
`PROWLARR_API_KEY` in `.env` doesn't match Prowlarr. Compare:

```bash
grep -i apikey /home/osvaldoramirez/movies/data/prowlarr/config.xml
grep PROWLARR_API_KEY ~/docker/movies/streamhub/.env
```

They must be identical (Prowlarr also shows it under *Settings → General*). After changing `.env`: `docker compose up -d`.
(In earlier versions this situation looked like "session expired" and bounced you to the login page. It no longer does — the app tells you what is wrong and keeps you signed in.)

**"Your browser could not play this file."**
Browsers cannot decode every release: HEVC/x265 or AV1 video, and AC3/DTS/Atmos audio, often fail. StreamHub ranks H.264 + AAC releases first and marks risky ones in the **Sources** list; pick another one. (There is no transcoding, to keep this free and light.)

**The public site (Cloudflare) still shows an old version.**
- In Cloudflare Zero Trust → *Networks → Tunnels → your tunnel → Public Hostname*, the service for your hostname must be `http://localhost:3111` (that is this app's port).
- Cloudflare dashboard → *Caching → Configuration → Purge Everything*.
- From now on `index.html` is sent with `Cache-Control: no-store`, so new versions are picked up immediately.

**Playback starts slowly or fails.**
Speed depends on seeders. StreamHub waits up to ~25 s for peers per source and then tries the next one.

## How it fits together

```
Browser ──► nginx (frontend container, :3111)
              ├─ /            React app
              ├─ /api/*   ──► Express backend ─┬─► TMDB        (catalog, posters, trailers)
              │                                ├─► Prowlarr    (find releases)
              │                                ├─► TorrServer  (add torrent, pick file)
              │                                └─► SQLite      (accounts, profiles, progress, My List)
              └─ /stream/* ─► TorrServer (video bytes, Range requests)
                              └─ every request is first checked against your login session
```

Only port 3111 needs to be exposed. The backend and TorrServer are reachable only inside Docker.

## Notes

- **Security**: sign-in is required for the API *and* for the video stream. Login attempts are rate-limited. The Prowlarr API key is never sent to the browser. Accounts can only be created by the admin (command above).
- **Content**: Prowlarr and TorrServer are general-purpose tools. Only stream content you have the right to access.
- **Not included**: subtitles/audio-track switching and transcoding (the file is streamed exactly as it is).
- Trailers on the home page are YouTube embeds and need internet access in the browser.
