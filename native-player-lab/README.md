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
