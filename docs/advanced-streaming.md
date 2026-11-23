# StreamHub Phase 3: Advanced streaming

This release **does not alter `docker-compose.yml`, `.env`, or any volume mount**. It adds SQLite tables/columns in `data/app/streamhub.db`, and stores downloaded videos under `data/app/library/` and SQLite backup snapshots under `data/app/backups/`. Source files, backups, and their metadata remain on the server and are ignored by Git.

## Deploy safely

1. Confirm your current Git remote and branch (`git remote -v; git status --short`). Stop if the working tree has unexpected changes.
2. Record running mounts using `sudo docker inspect streamhub-backend prowlarr torrserver --format '{{.Name}} {{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'`.
3. Briefly stop **only** the backend, copy `data/app/` to a backup directory outside the repository, then restart the backend. If possible also copy the private `.env` to your backup directory; never commit it.
4. Pull on the correct branch and compare `sudo docker compose config` mount paths with Step 2. Do not start the upgrade if paths change.
5. `sudo docker compose up -d --build` and check the backend logs; all SQLite changes are additive.

## Download queue and library

From the player, choose **Save on server**. The selected file enters a one-at-a-time queue. Open **Library** to pause, resume, delete, or play a completed download. The administrator may set a global library quota (10–200 GB) and queue transfer rate. Files can resume from a `.part` file if TorrServer supports HTTP Range; if it does not, StreamHub restarts the incomplete file rather than corrupting it. Torrents must be available to TorrServer again after a restart for continued downloads. Ordinary **Download** still sends the file directly to the watching device.

Saved videos and all queue rows belong to the profile that started them. They are not shared across accounts or other profiles. Deleting a queue entry also deletes its stored file, but **never deletes watch history**.

## Optional conversion

In the player, **Convert video** switches to H.264 / AAC fragmented MP4 at 480p or 720p, with `ultrafast` CPU settings. This is deliberately **single-session** to protect the Mac mini 2012. It can use an existing torrent or a locally saved video. It is not a permanent converted copy and does not change source files. Seeking restarts conversion; if the source lacks peers or a readable video stream, conversion can fail. Direct playback stays the default.

## Quality and bandwidth

Each profile has a preferred source quality and direct-stream bandwidth ceiling (0, 2, 5, 10, 20, 40 Mbps). Preferred quality affects **automatic source ranking**; it cannot magically lower the resolution of a manually selected file. The bitrate cap is enforced by Nginx on `/stream/` through its existing authentication subrequest. Audio-fix and conversion streams are separate endpoints; do not treat this cap as a guarantee on those paths. Server-side download speed has its own administrator-set limit.

## Monitoring and backups

An administrator sees active devices (sessions active within two minutes), job counts, disk space, backend memory/uptime, conversion status, and lightweight counts of playback/download/backup events. The default automatic backup interval is 24 hours (configurable, including off). SQLite snapshots are made using SQLite's online backup mechanism, **not a raw copy of an open database**, and retained up to 14 files. Backups contain the StreamHub database only: they **do not include** Prowlarr/TorrServer settings, original media, the `.env` file, or Docker volumes. Download snapshots to a separate device and independently back up the entire `data/` tree if you need complete recovery.

## Device handoff

While a video is playing, the browser reports its current title and time to the server for **that unlocked profile only**. The Library or Settings page shows other active devices. **Continue here** resumes the same title at its recorded position and sends a pause request to the previous device. A background tab/device may not react immediately, but its progress is retained. The list expires devices five minutes after their last heartbeat. No device IDs or watch history are shared across profiles.

## Current limits

- No automatic high-quality re-encode, GPU transcoding, or adaptive multi-bitrate HLS ladder.
- No file-level sharing between profiles or offline playback within the browser PWA.
- Manually selected files may exceed the preferred quality ceiling.
- When a remote media source expires, an unfinished queued download may need to be resumed after finding a working source.
- Playback handoff is best effort and depends on the old browser staying connected long enough to receive the pause signal.
