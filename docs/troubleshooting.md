# Troubleshooting

## Service will not start
[TODO: Describe how to troubleshoot service startup.]

## Service is unreachable
[TODO: Describe how to troubleshoot unreachability.]

## DNS problems
[TODO: Describe how to troubleshoot DNS.]

## HTTPS or certificate problems
[TODO: Describe how to troubleshoot certificates.]

## Login problems
[TODO: Describe how to troubleshoot logins.]

## Permission problems
[TODO: Describe how to troubleshoot permissions.]

## Storage problems
[TODO: Describe how to troubleshoot storage.]

## Reverse-proxy problems
[TODO: Describe how to troubleshoot proxy errors.]

## Remote-access problems
[TODO: Describe how to troubleshoot remote access.]

## Update problems
[TODO: Describe how to troubleshoot updates.]

## Backup and restore problems
[TODO: Describe how to troubleshoot backups.]


## Repeated 504 errors while preparing a movie or episode

A Cloudflare 504 means the proxy did not receive a timely response; it **does not prove Docker is stopped**. The player may successfully search indexers but then wait for TorrServer to obtain torrent metadata from peers. Check whether the same source works over the LAN/Tailscale (bypassing Cloudflare). Inspect the backend and TorrServer logs using `sudo docker compose logs --tail=100 backend torrserver` and verify `sudo docker compose ps`. A title ending in `.srt` or a tiny subtitle release is not a movie: the source-selection filter now discards it and torrent playback rejects torrents without a real video file. If a source has no peers, select a different release; shortening timeouts prevents long loading screens but cannot manufacture missing peers.

If playback says **Preparing audio fix** for an AAC-labeled release, try direct playback first. Audio repair is reserved for explicitly requested repair or releases not already known to have browser-safe audio; actual media metadata can still disagree with the release title. The Mac mini should not run full conversion unnecessarily.
