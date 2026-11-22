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

## v0.3.6 — Gray-screen diagnostic, compare v0.2.1

The owner confirmed v0.2.1 Build #5 actually showed picture and sound on
the TV with the offline synthetic clip. v0.3.x began showing gray then exiting
after HLS integration. Regressions must be diagnosed in the added network
handoff and downloaded elementary streams; do not rewrite working NDL/ACB.

Adds temporary phase-only (no credentials or stream URLs) diagnostic reports
to the isolated Render service: missing pending clip, TLS/network failure,
download/format failure, NDL/ACB first-frame status. After testing, reopen the
Native HLS Lab launcher and select "Son Auto Hatasini Goster". It shows the
latest phase from the same internet exit address. A missing report is
inconclusive because older webOS curl may fail TLS before reporting.

This is instrumentation, not a verified playback fix.

## v0.4.0 — One native IPK: film search and first-frame-tested NDL/ACB

This is an experimental *single application* for LG webOS 2.0:
`com.xiptvplay.playerlab.unified_0.4.0_arm.ipk`.
The entire user interface uses SDL2 in the same native ARM process as the
two first-frame-tested media decoders. It does **not** launch a second app
or depend on PalmServiceBridge.

First-run setup: TV displays an eight-character short-lived pairing code.
Open `https://xiptvplay-native-lab.onrender.com/pair` on a phone, enter
the TV code and the Xtream M3U get.php playlist URL. Pairing credentials
are sent once to the native app over HTTPS, then stored in a user-only
plaintext file under its HOME folder; never embedded in the IPK or source.
The server forgets pairing data when collected or expired. The same TV can
then search titles using its remote-controlled on-screen keyboard and hit
OYNAT to prepare, download and play a **test eight-second clip** through
NDL, with ACB fallback only when the first-frame callback fails.

Native UI and decoder run sequentially in one OS process; SDL is closed before
opening the decoder's video plane and reinitialized after the clip ends.
Search input and menu rendering are basic ASCII bitmap text, currently for
technical testing, not the final polished XIPTV UI. Search requests are
bounded and use the existing authenticated catalogue endpoint.

Known limitations: webOS 2's HTTPS CA/curl compatibility must be tested;
input via remote may be cumbersome; server-rendered 8-second clip still has
fixed 640x360/25fps metadata that can mismatch original media; movie search
only, not episodes; local credential storage is not encrypted; network
operations may momentarily block UI; availability of SDL video reinit
after media playback is not confirmed on real TV. CI compilation is not
evidence that actual IPTV video plays. Original v0.2.1 Build #5 remains
unchanged and is the known-good decoder baseline.

## v0.4.1 — Boot-screen-first fix for gray screen

User reported v0.4.0 unified IPK remains gray from launch. Its main
previously initialized curl and synchronously requested the pairing code
before the first SDL frame, which could block rendering on old TVs.
This version opens SDL and presents the native menu **before** curl init,
and obtains a code only on OK. Failures leave the menu visible rather
than silently failing. This is an unverified candidate until device test.
Do not change known-good v0.2.1 Build #5.

## v0.4.2 — Isolated native menu surface diagnostic

LG 49UF8507-ZB owner reports solid pale-gray screen on v0.4.1 before any
menu text. Previously menu reused `sdl_shell_open_window()`, intentionally
built for *transparent video-plane punch-through*. The unified app now
separates the **opaque menu SDL window/renderer** from the original
transparent hardware-video decoder windows. Menu requests a visible
fullscreen window, full window opacity, software renderer with accelerated
fallback, disables blend, and logs boot/window/first-present checkpoints
in `/tmp/xiptv-native-unified-boot.log` for developer diagnostics.
First frame is still drawn before network operations. This is an unverified
candidate: passing GitHub CI cannot establish that webOS 2 compositor shows
an opaque SDL surface. Original v0.2.1 Build #5 remains untouched.
