# XIPTV Play TV Player — webOS 2.0 playback architecture

Target: LG 49UF8507-ZB (2015), webOS 2.0 / WebKit 538.2. The Native IPK app identity and working Live TV path must be preserved.

## Goal
Make VOD playback independent of a provider's file extension, host redirects and codec changes where technically possible. No player can guarantee all DRM-protected video or codecs unsupported by the device without a compatible licensed conversion pipeline.

## What was confirmed on the target TV
- Local H.264 MP4 plays to completion.
- Remote MDN MP4 plays to completion.
- Audio was heard during a remote sample playback (that sample visually identified WebM; do not assume AAC support from it).
- Live IPTV channels play.
- A provider VOD HEAD request returned HTTP 200 with Content-Type video/x-matroska.
- Raw VOD MKV and earlier compatibility MPEG-TS/short MP4 attempts failed with MEDIA_ERR_SRC_NOT_SUPPORTED (4).
- FFprobe in the Render media service has exited SIGSEGV; a previous FFmpeg transcode failed due to a 5XX response from the upstream relay.

## Research and feasibility
- LG official webOS 2.0 AV format table supports MKV, MP4, TS and defined H.264/HEVC profiles; support varies with container, actual stream codec, bit depth and model.
- LG's webOS backward-compatibility guide explicitly says webOS 2.0 WebKit may keep HTMLMediaElement.readyState at HAVE_NOTHING. Use timeupdate/currentTime or decoded-data events for success detection instead of readyState>=2.
- Shaka/hls.js/mpegts.js are primarily MSE clients; browser compatibility and MSE support must be feature-tested on this 2015 model, never inferred from modern webOS samples.
- Native Rust/FFmpeg/Starfish community projects (e.g. mac-lucky/webos-iptv-native) provide a useful research reference but are tested on newer sets. Check ABI/toolchain, legality/licensing and hardware-pipeline access before integration. The popular lennylxx/webos-iptv-player requires webOS >=4 and cannot be copied wholesale.
- libVLC is not an installable drop-in JavaScript module for this TV. A port needs webOS 2 ARM native binaries, software/hardware decode output, audio, remote input, package permissions, and sufficient RAM/CPU. LGPL/GPL compliance and third-party notices would be mandatory.

## Proposed modular transport policy (VOD only)
1. Resolve Xtream metadata to candidate endpoints. Preserve original extension; verify actual upstream status, Content-Type, redirects and byte-range behavior without exposing credentials. Never treat HEAD 200 as proof that a GET can be decoded.
2. Try LG native playback with the real content type and extension, one bounded attempt per URL, only when codec/container support has been verified.
3. If container incompatible but codecs supported: FFmpeg remux without recompression into a TV-supported MP4 or compatible HLS. Preserve audio track options if verified.
4. When codec unsupported: FFmpeg H.264/AAC transcode using chunked segments / adaptive HLS or complete MP4 test fragments with correct seek and Content-Range. Keep cache and TTL bounded; protect upstream credentials and deny private/loopback hosts.
5. Log per-phase bounded diagnostics with no URL, username or password. Maintain last-known-good transport by provider/content type. Do not repeatedly switch sources during playback, and do not start concurrent provider connections.

## Reliability gates
- Native IPK app ID and update-over-install behavior unchanged.
- Live TV source selection untouched.
- Profiles/PIN, subtitles, audio tracks, season progression, resume and player navigation regression-tested.
- Real LG webOS 2.0 test must check 10+ actual film/series combinations (MKV/H264, MKV/HEVC, AAC, EAC3, HLS, TS, MP4) and long seek/resume. CI pass does not demonstrate device compatibility.
- Render Free instance CPU, cold start, memory and bandwidth capacity verified before enabling full-length transcoding.
- Native FFmpeg/libVLC integration remains a separate feasibility prototype; never replace the working application or its architecture without explicit user approval.

## References
- https://webostv.developer.lge.com/develop/specifications/video-audio-20
- https://webostv.developer.lge.com/develop/guides/backward-compatibility
- https://github.com/mac-lucky/webos-iptv-native
- https://github.com/lennylxx/webos-iptv-player

## v1.0.78 (Build after #298) — VOD transport recovery groundwork
- Film and series start with the selected native URL. If no meaningful time progress and an initial source fails or stalls, at most one retry uses the existing Render IPTV proxy. This is scoped to VOD and does not run on Live TV.
- Proxy is a transport fallback, **not** a decoder or transcoder. If LG still reports error 4 (unsupported codec/container), the player explicitly offers the existing experimental compatibility/MP4 clip tests. Those tests are not full-length playback.
- webOS 2 detection uses advancing currentTime, not readyState or a lone playing event. Startup retries stop after decoded progress, so later runtime network errors cannot cause hidden source switches.
- Full FFmpeg remux, continuous HLS transcode, audio switching and seeking across converted sources remain later phases, pending deployment validation and actual LG hardware testing. No claims of universal codec support.
