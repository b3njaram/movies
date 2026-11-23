# StreamHub

**Phase 2:** TV remote navigation and browser-native casting, manual Skip Intro/Credits markers, on-demand timeline preview frames, per-profile recommendations and Discover filters, and PIN-protected profiles with server-enforced age limits. See [Phase 2 guide](docs/premium-experience.md).

A self-hosted, Netflix-style streaming front end for **your own** Prowlarr indexers and TorrServer.
No subscriptions, no Debrid — everything runs on your machine.

## What you get

- **Sign-in screen** and **"Who's watching?" profiles** (as many as you like per account, avatars, Kids profiles, manage / edit / delete).
- **Netflix-style home**: auto-playing trailer billboard, hover-expanding cards, scrolling rows, *Continue Watching* with progress bars, *Up next* for the following episode, *My List*.
- **Title pages**: synopsis, cast, seasons and episodes (with per-episode progress and "Watched" marks), *More Like This*.
- **One-click Play**: StreamHub searches your indexers, ranks the releases (**AAC audio first**, H.264, CAMs and wrong-year remakes filtered out), connects through TorrServer and starts streaming. If a source is dead — it never connects, connects but cannot be decoded, or connects but sends no data for 45 seconds — it moves on to the next-best one by itself (up to 8 sources, never repeating a failed one). A source you pick yourself from the Sources list is never swapped behind your back.
- **Language preference (English or Español), per profile.** Every release shows its audio language (EN, ES·LAT, ES·ESP, EN+ES·LAT, FR…, read from the release name; `EN?` means nothing is stated, so English is assumed). Releases in your language are ranked and played first; with Spanish selected StreamHub also searches the Spanish title (Spanish releases are named "El Padrino", not "The Godfather"), and Latino ranks just above Castellano. Set it when editing a profile, or switch it any time in the Sources panel.
- **See what it is doing without interrupting the film.** While StreamHub works through sources, the loading screen lists each one it tries and how it went. Once something plays, a short "Now playing" notice names the exact release (and how many failed first). The **Sources** button opens a side panel — the video keeps playing and the keyboard shortcuts keep working — listing *this viewing* (every source tried: playing / would not play and why) with a **Download this file** button on the one that is playing, plus all other sources for the title.
- **Sources for every title and every episode** (the list button on the title and on each episode row). Each source shows its quality, audio format and seeders, and has three actions: **Play**, **Audio fix** and **Download**.
- **Audio fix** — for releases that play with picture but no sound (AC3 / E-AC3 / DTS / TrueHD audio is not supported by Firefox and others). The picture is passed through untouched and only the sound is converted to AAC on the fly (ffmpeg, very light on the CPU). Pick the audio language when the file has several. A **"No sound?"** prompt appears by itself when the browser reports no playable audio, and the choice is remembered.
- **Download** — saves the file to the device you are watching on (your phone, laptop…), with resume support. For an episode inside a season pack, only that episode is downloaded.
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

## Install

You need Docker with the compose plugin and git.

```bash
git clone https://github.com/YOUR-USER/streamhub.git
cd streamhub
cp .env.example .env && nano .env     # PROWLARR_API_KEY, JWT_SECRET (openssl rand -hex 32), TMDB_API_KEY
docker compose up -d --build
./add-user.sh admin 'choose-a-password'
```

Open `http://<this-machine>:3111`. Prowlarr is on port 9696 (add your indexers there and copy its API key into `.env`).

## Updating (every time)

```bash
cd ~/docker/streamhub
./update.sh
```

That runs `git pull`, rebuilds the containers and restarts them. It first compares the data folders the running Prowlarr/TorrServer use with the ones compose is about to use, and **stops without touching anything** if an update would silently point them at an empty folder (it prints the exact line to add to `.env`).

Then hard-refresh the browser (Ctrl+Shift+R).

## Moving an existing zip-based install to GitHub (one time)

Do this on the Mac Mini. Your accounts, watch history, Prowlarr indexers and `.env` are kept.

1. **Publish the repository** (from the folder this project was unpacked into):
   ```bash
   cd ~/docker/streamhub
   sudo dnf install -y gh            # GitHub's command-line tool
   gh auth login                     # GitHub.com -> HTTPS -> log in with the browser
   gh repo create streamhub --private --source=. --remote=origin --push
   ```
   (No `gh`? Create an empty private repo `streamhub` on github.com, then
   `git remote add origin git@github.com:YOUR-USER/streamhub.git && git push -u origin main`.)

2. **Stop the old install** (data stays on disk):
   ```bash
   cd ~/docker/movies/streamhub && sudo docker compose down
   ```

3. **Bring over your settings and data** into the new folder:
   ```bash
   cd ~/docker/streamhub
   cp ~/docker/movies/streamhub/.env .env
   sudo cp -a ~/docker/movies/streamhub/data ./data        # accounts, profiles, watch history, My List
   cat >> .env << 'EOF'
   PROWLARR_CONFIG_DIR=/home/osvaldoramirez/movies/data/prowlarr
   TORRSERVER_CONFIG_DIR=/home/osvaldoramirez/movies/data/torrserver
   EOF
   ```
   Check that the two folders are the ones you expect **before** starting:
   ```bash
   sudo docker compose config | grep -B1 -A1 "target: /config\|target: /opt/ts/config"
   ```
   The `source:` lines must show `/home/osvaldoramirez/movies/data/prowlarr` and `.../torrserver`.

4. **Start it:**
   ```bash
   sudo docker compose up -d --build
   ```
   From now on, updating is just `./update.sh`.

### Accounts and profiles

There is **no limit** on accounts or on profiles per account.

```bash
./add-user.sh <username> <password>      # new login, or resets the password of an existing one
```

Each login can add as many profiles as it wants from the "Who's watching?" screen (Manage Profiles → Add Profile). Accounts can only be created by whoever runs the command above, which keeps strangers from signing themselves up on a public address.

## Troubleshooting

**A red banner says Prowlarr rejected the API key.**
`PROWLARR_API_KEY` in `.env` doesn't match Prowlarr. Compare:

```bash
grep -i apikey /home/osvaldoramirez/movies/data/prowlarr/config.xml
grep PROWLARR_API_KEY ~/docker/movies/streamhub/.env
```

They must be identical (Prowlarr also shows it under *Settings → General*). After changing `.env`: `docker compose up -d`.
(In earlier versions this situation looked like "session expired" and bounced you to the login page. It no longer does — the app tells you what is wrong and keeps you signed in.)

**A release plays but has no sound.**
Almost always the audio format (AC3, E-AC3/DD+, DTS, TrueHD, Atmos): browsers — Firefox especially — cannot decode it. Press **Audio fix** in the player (top right) or choose it on a source; the picture stays identical and the sound is converted to AAC. StreamHub also ranks AAC releases first, so this happens less.

How the audio fix behaves, so nothing surprises you:
- It needs **H.264 video**. For HEVC/x265 or AV1 video it cannot help, and the player tells you so — choose another source.
- Seeking restarts the converted stream at the new point (about a second of buffering), and it lands up to a few seconds before the exact spot (it starts on a keyframe).
- At most 3 audio-fix streams run at once (`MAX_AUDIOFIX`). Closing the player stops ffmpeg immediately.
- Subtitles are not included.

**"Your browser could not play this file."**
Usually HEVC/x265 or AV1 *video*. Choose another source (the Sources list flags them).

**The public site (Cloudflare) still shows an old version.**
- In Cloudflare Zero Trust → *Networks → Tunnels → your tunnel → Public Hostname*, the service for your hostname must be `http://localhost:3111` (that is this app's port).
- Cloudflare dashboard → *Caching → Configuration → Purge Everything*.
- From now on `index.html` is sent with `Cache-Control: no-store`, so new versions are picked up immediately.

**An error mentioning Cloudflare (or a screen full of web-page code).**
That page comes from Cloudflare, not from this app. The message now says which error it was:
- *Error 524 / "took longer than 100 seconds"* — a request ran past Cloudflare's limit. Searches now ask each indexer separately with a 25 s timeout (40 s overall) and skip slow ones, and a note under the list names them. If an indexer is *always* skipped, check it in Prowlarr → Indexers (indexers behind Cloudflare protection need FlareSolverr to be working).
- *"firewall blocked this request" / error 1020 / 403* — Cloudflare's WAF rejected the request, usually a false positive on a title or a magnet link. In Cloudflare: **Security → Events**, find the blocked request and note the rule. The API is already behind your login, so a custom rule is reasonable: *Security → WAF → Custom rules* → expression `(http.host eq "movies.jobbisoft.com.mx" and starts_with(http.request.uri.path, "/api/"))` → action **Skip** (the managed rules).
- *Error 502 / 52x / 530* — Cloudflare cannot reach your server. Check `sudo docker ps` (all five containers up) and that the tunnel points at `http://localhost:3111`.
- The Ray ID in the message lets you find that exact request in Cloudflare → Security → Events (for blocks) or the tunnel logs.

## Keeping Cloudflare in front without it getting in the way

Recommended settings in the Cloudflare dashboard for `movies.jobbisoft.com.mx`:

1. **Let your API through the firewall rules.** *Security → WAF → Custom rules → Create rule*
   - Expression: `(http.host eq "movies.jobbisoft.com.mx" and (starts_with(http.request.uri.path, "/api/") or starts_with(http.request.uri.path, "/stream/")))`
   - Action: **Skip** → tick *All managed rules* (and *Super Bot Fight Mode rules* if shown).
   Everything under those paths already requires your login.
2. **Bypass the cache for those paths.** *Caching → Cache Rules → Create rule* with the same expression → *Bypass cache*. (The app also sends `Cache-Control: no-store`, so this is a second safety net.)
3. **Bots.** *Security → Bots*: if *Bot Fight Mode* is on and you see "Just a moment…" pages or blocks, turn it off for this hostname (the skip rule in step 1 covers Super Bot Fight Mode on paid plans).
4. **Timeouts.** Cloudflare's free plan stops any request that waits more than 100 seconds for the first byte. This app keeps every request well below that (searches ≤ 40 s, adding a torrent ≤ ~65 s). Video and downloads are not affected because they keep sending data.
5. **Video through Cloudflare.** Cloudflare's terms restrict serving large amounts of video through its proxy on regular plans. Many people stream through tunnels anyway, but if you push a lot of video over it, Cloudflare can throttle or warn the account. Read the current terms (Self-Serve Subscription Agreement, "non-HTML content") and decide. Safer alternative: watch over **Tailscale** (`http://macmini2012:3111` from any device on your tailnet) and keep Cloudflare for browsing and guests.

### If Prowlarr's indexers are blocked by *their* Cloudflare (FlareSolverr)

Prowlarr → *Settings → Indexers → Indexer Proxies → + → FlareSolverr*, host `http://<LAN IP of the Mac Mini>:8191` (the FlareSolverr container publishes port 8191; `hostname -I` shows the IP), press **Test**, give it a tag such as `flare`, then add that tag to the indexers that sit behind Cloudflare (*Indexers → edit → Tags*). Indexers that still time out are skipped by StreamHub and listed under the results.

**Playback starts slowly or fails.**
Speed depends on seeders. StreamHub waits up to ~25 s for peers per source, and if a source connects but still shows no picture after 45 s it tries the next one. After 8 failed sources it stops and tells you; open **Sources** to choose one yourself.

## How it fits together

```
Browser ──► nginx (frontend container, :3111)
              ├─ /            React app
              ├─ /api/*   ──► Express backend ─┬─► TMDB        (catalog, posters, trailers)
              │   (/api/download, /api/audiofix/*: unbuffered)
              │                                ├─► Prowlarr    (find releases)
              │                                ├─► TorrServer  (add torrent, pick file)
              │                                └─► SQLite      (accounts, profiles, progress, My List)
              └─ /stream/* ─► TorrServer (video bytes, Range requests)
                              └─ every request is first checked against your login session
              Audio fix: backend ─► ffmpeg ─► (video copied, audio → AAC) ─► browser
```

Only port 3111 needs to be exposed. The backend and TorrServer are reachable only inside Docker.

## Notes

- **Security**: sign-in is required for the API *and* for the video stream. Login attempts are rate-limited. The Prowlarr API key is never sent to the browser. Accounts can only be created by the admin (command above).
- **Content**: Prowlarr and TorrServer are general-purpose tools. Only stream content you have the right to access.
- **Not included**: subtitles, and video transcoding (the picture is always streamed exactly as it is; only the audio can be converted).
- Trailers on the home page are YouTube embeds and need internet access in the browser.

## Phase 1 — Everyday usability (November 2026)

This update is additive. **Do not replace your existing `.env`, `data/`, or Docker bind mounts.**
The same React/Vite + Express + SQLite + Docker Compose architecture remains in place.

### What's new

- **Captions:** Open **CC** in the player to choose Off / English / Español. The app lists compatible `.srt` / `.vtt` *sidecar* files contained in the same torrent as the playing video and converts SRT to WebVTT on the backend. You can also load an SRT/VTT file from your device for the current viewing. Default caption language is saved per profile. **Limitations:** captions inside MKV containers are not extracted yet, and no online subtitle service is called. If a torrent has no matching sidecar, use a local subtitle file.
- **Better source choice:** Before automatically trying a release, StreamHub uses the current browser's codec support and the profile's quality preference (Auto, 4K, 1080p, or 720p). It prefers compatible formats, learns the *release title* that played successfully on the device, and still lets you choose a source manually. Unknown codec labels remain best-effort; this does not add full video transcoding.
- **Admin dashboard:** The earliest existing user (by SQLite user ID) becomes the initial administrator. On a new installation, the first account created through `./add-user.sh` becomes administrator. Administrators can create users, reset passwords, enable/disable non-admin accounts, and inspect basic service health and aggregate counters. Resetting a password or disabling a user invalidates previous sessions. Admin privileges are verified server-side for every request. `./add-user.sh` continues to work.
- **Mobile PWA:** Users of supported browsers can install StreamHub from their browser. The static application shell can be cached, but video, downloads, login responses, watch history, and API traffic are *never* cached by the service worker. This is not offline movie playback.
- **English/Spanish interface:** The header and login page have UI-language switches, with language saved per profile. Audio language and subtitle language are independent of the interface language.

### Safe upgrade of an existing Mac mini installation

Keep using `~/docker/movies/streamhub` if that is your running installation. You don't need to clone to a new folder. Before the first upgrade, make a database backup while the backend is stopped:

```bash
cd ~/docker/movies/streamhub
sudo docker compose stop backend
sudo mkdir -p "$HOME/streamhub-backups"
sudo cp -a data/app "$HOME/streamhub-backups/app-$(date +%Y%m%d-%H%M%S)"
sudo docker compose start backend

git remote -v                  # must point to github.com/b3njaram/movies
git status --short             # resolve local source changes before pulling
git pull --ff-only origin main
sudo docker compose config | grep -B1 -A1 'target: /app/data\|target: /config\|target: /opt/ts/config'
# Compare these paths with: sudo docker inspect streamhub-backend prowlarr torrserver
# If they are different, fix the mount references before recreating containers.
sudo docker compose up -d --build
```

No new `.env` variables or volumes are required. The SQLite migration adds columns to the existing tables only; it preserves accounts, password hashes, profiles, lists, and viewing progress. The migration is designed to be repeatable. Do not run `docker compose down -v` or delete `data/`.

### Verification

The repository includes tests for safe subtitle matching and conversion, client-side compatibility sorting, and preservation of the legacy SQLite schema. Run:

```bash
node --test backend/test/*.test.js frontend/test/*.test.js
python3 tests/migration.test.py
cd frontend && npm install && npm run build
```

The GitHub Actions workflow builds the frontend and checks the tests on pushes and pull requests. Browser/video/device behavior should still be checked against a live Prowlarr/TorrServer instance after deployment.
