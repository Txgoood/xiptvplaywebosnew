# XIPTV Play TV AI Test: alternative VOD engine (branch `ai-alt/webos2-vod-player-20261122`)

Experimental package only: app id `com.xiptvplay.tv.experiment`, title `XIPTV Play TV AI Test`.
It installs next to `XIPTV Play` and `XIPTV Play Native`. Live TV code paths are not modified.

## Verified constraints (LG documentation, 2026-11-22)
- webOS TV 2.x has **no MSE/EME**: Shaka, hls.js and mpegts.js cannot run on this TV. Native `<video>` only.
- Native HLS is **v3 only**: no `EXT-X-MEDIA` (separate audio/subtitle groups), no `EXT-X-BYTERANGE`, no fMP4 (`EXT-X-MAP`).
- AV table: MP4 = H.264/HEVC + AAC/MP3; MKV = AC3/DTS/AAC/MP3 (no E-AC3); TS = also AC3/E-AC3. Subtitles: WebVTT only.
- Render free: 0.1 CPU / 512 MB, Hobby workspace 5 GB/month outbound. Streaming whole films through it is not sustainable.

## Phase A (this build): runs entirely on the TV, no server cost
`webos/tv-ai-engine.js` (ES5), loaded last, only in the experiment package.
1. Watches VOD (movie/series) startup. Triggers on TV error code, 24 s without progress, or the series-HLS recovery giving up.
2. **Inspector** (read-only Range requests, from the TV's own network): per extension (`.m3u8 .mp4 .mkv .ts`) HTTP status, content type, range support; the alternate http/https scheme; then container + codecs
   (HLS master/media tags, first TS segment PAT/PMT, MKV codec IDs, MP4 `moov`/`avcC`/`hvcC`).
3. **Decision** against the LG table: `native-ok`, `transcode-audio`, `transcode-video`, `manifest-fix`, `unknown`.
4. **Bounded auto-recovery**: at most 3 real playback attempts (other extensions, then the other scheme); only an advancing `currentTime` counts as success.
5. **Learned rule** (never from a normal successful start): "when `.X` fails on this host, use `.Y` over `<scheme>`". Per kind and host, 30-day expiry, dropped if it fails again. No credentials or full URLs are stored or displayed (host is masked).
6. The report is shown as an on-screen overlay so it can be photographed.

`XIPTVVODRecovery.start` is disabled in this build; the engine owns VOD recovery.

## Phase B / C (not implemented, need a decision on where to run)
- B: HLS manifest rewriter (pick one variant, drop `EXT-X-MEDIA`, absolute URLs). Segments stay on the provider; tiny bandwidth.
- C: remux/transcode (MKV to TS/HLS copy, E-AC3 to AAC, HEVC to H.264). Needs real CPU and bandwidth, so not the free Render service.

## Build
`.github/workflows/build-webos-ai-alt.yml` runs only for `ai-alt/**` pushes. Its run number is its own counter (starts at 1).
