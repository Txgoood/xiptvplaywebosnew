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

## v0.3.0 — Actual provider HLS to native engine clip, isolated

Four packages:
- Auto native `com.xiptvplay.playerlab.auto_0.3.0_arm.ipk`.
- Native HLS Lab browser `com.xiptvplay.playerlab.launcher_0.3.0_all.ipk`.
- Previous standalone NDL/ACB packages, versions 0.2.0 (no change).

The separately deployed `native-player-lab/relay.mjs` is the **only** bridge
from an authenticated Xtream/HLS URL to the NDL/ACB player: it uses the LG
media companion's existing validated `/tracks` and `/compat-mp4/prepare`,
then demuxes the complete 8-second MP4 into H.264 Annex B + AAC ADTS.
It returns two 48-hex-token short-lived media URLs, **never upstream
password-bearing URLs**. The native C downloader accepts only URLs from the
exact configured HTTPS test bridge, rejects redirects, bounds length,
validates Annex-B/ADTS magic, and removes temporary files after playback.
It does not need root.

The launcher is a separate web app: on TV enter server origin, username,
password, content ID (movie or individual series episode), and extension.
Credentials are sent to the LG-only *test* bridge for Xtream validation and
are not persisted in browser localStorage or native URL/launch params.
The test must be used only with media the subscriber is authorized to watch.
Install **both** Auto and Native HLS Lab IPKs. The unchanged XIPTV main app
is not modified, and the test relay must be deployed separately on Render.
No 8-second clip is claimed as full film playback.

Known uncertainties: old firmware HTTPS/libcurl compatibility, CORS in webOS
web views, ability to launch the native package via PalmServiceBridge, and
the exact provider's HLS `.txt` segment behavior. GitHub builds and
a synthetic conversion test cannot replace actual on-TV validation.

## v0.3.2 — User-facing account import and movie name discovery

Fix HTTP 403 ("Web origin not allowed") for legacy packaged webOS origins.
The **isolated** Native HLS Lab endpoint supports credentialless cross-origin
requests (no cookies); unlike the production services it is separately rate-limited.
Movie search fetches authenticated Xtream `get_vod_streams`, validates the
provider host through existing LG-only account verification, returns up to
30 movie titles and their numeric IDs. The user does not guess content IDs.
Only movie search is implemented in this initial build, not series episodes.

Launcher adds an optional `get.php?username=...&password=...` M3U URL importer.
It parses and clears the link input and preserves the upstream scheme, including
plain `http://` when that is the **provider** URL. TV-to-Render remains HTTPS.
No username or password is baked into source, CI, IPK or Render environment.
When the optional remember checkbox is checked, account details are stored in
the TV browser's localStorage *in plaintext*. There is a "clear saved details"
button, and a checkbox for users who do not want persistent credentials.
The login data is transmitted to the isolated Render endpoint in the HTTPS
POST body; the provider-specific hop follows the source URL scheme.
