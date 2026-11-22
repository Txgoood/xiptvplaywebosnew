# XIPTV Play Native Player Lab v0.1.0

Separate branch: feat/native-player-lab-webos2-20261122.

Two dedicated ARM IPKs for LG webOS 2.x:
- com.xiptvplay.playerlab.ndl (NDL Esplayer)
- com.xiptvplay.playerlab.acb.webos2 (Starfish Media Pipeline with ACB)

These are purely offline native hardware decoder tests. They should show an animated
ten-second test pattern and a 440 Hz AAC sound. They cannot open Xtream/HLS/MKV
IPTV links yet: the upstream samples require pre-demuxed H.264 and AAC streams.

Pinned upstream source: webosbrew/samples a8833ae3170283379fab08b463d3a177722c46c8.
Unofficial native SDK: openlgtv/buildroot-nc4 2026.08-webos.
Upstream samples do not contain an explicit LICENSE file; confirm permission
before public redistribution. This is intended for the project owner's private
technical testing only.

CI success does not establish playback on LG 49UF8507-ZB. Install both via
webOS Dev Manager, test NDL first, ACB second. No main XIPTV app, provider
credentials, Render settings or Android project are changed.

## v0.2.0 — Automatic NDL -> ACB fallback

New standalone ARM native IPK: `com.xiptvplay.playerlab.auto`.
The launcher first starts NDL Esplayer and waits up to 12 seconds for the
actual `NDL_ESP_FIRST_FRAME_PRESENTED` callback. If no frame arrives
or NDL exits early, it stops/reaps NDL and starts Starfish/ACB, which is
confirmed by `SMP_EVENT_FRAMEREADY`. Engines never run concurrently.

Once a real first-frame callback is received, the launcher stays on the
successful engine until that clip exits. No switches during normal playback
or user exit. Existing two standalone apps are also packaged separately.

CI runs Linux host fallback simulations (failed child, first-frame success,
timeout), but only a real LG test can establish webOS native compatibility.

IMPORTANT: This version still plays a 10-second offline H.264/AAC sample.
It has **not** integrated provider HLS/Xtream, audio tracks or subtitle
selection; automatic fallback currently applies to decoder startup only.

## v0.2.1 — Gray-screen repair candidate

The previous automatic launcher created subprocesses using fork/exec.
User TV test: gray display, then automatic exit. The replacement bundles
both decoders into one native ARM executable and starts NDL first, falling
back to Starfish/ACB if no first-frame callback occurs. No second process
or filesystem marker is needed. Actual TV confirmation is still required.

The two standalone apps are included separately and remain undisturbed.
IPTV / HLS stream fetching remains outside of the current sample player.
