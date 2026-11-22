#!/usr/bin/env bash
set -euo pipefail
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
cc -std=c11 -Wall -Wextra -O2 native-player-lab/auto_engine.c -o "$root/launcher"
touch "$root/activity"
# Force NDL to exit before rendering. ACB sends a simulated first-frame marker.
cat > "$root/media-ndl-esplayer" <<'SH'
#!/bin/sh
echo ndl >> "$XIPTV_LAB_TEST_LOG"
exit 6
SH
cat > "$root/media-smp-acb-webos2" <<'SH'
#!/bin/sh
echo acb >> "$XIPTV_LAB_TEST_LOG"
printf 'ok' > "$XIPTV_LAB_READY_MARKER"
sleep 0.4
SH
chmod +x "$root/media-ndl-esplayer" "$root/media-smp-acb-webos2"
export XIPTV_LAB_TEST_LOG="$root/activity"
XIPTV_LAB_TIMEOUT_SEC=2 "$root/launcher"
test "$(cat "$root/activity")" = "$(printf 'ndl\nacb')"
# First-frame success on NDL must never launch ACB.
: > "$root/activity"
cat > "$root/media-ndl-esplayer" <<'SH'
#!/bin/sh
echo ndl >> "$XIPTV_LAB_TEST_LOG"
printf 'ok' > "$XIPTV_LAB_READY_MARKER"
sleep 0.4
SH
chmod +x "$root/media-ndl-esplayer"
XIPTV_LAB_TIMEOUT_SEC=2 "$root/launcher"
test "$(cat "$root/activity")" = "ndl"
# A hung NDL must be terminated, then ACB started once.
: > "$root/activity"
cat > "$root/media-ndl-esplayer" <<'SH'
#!/bin/sh
echo ndl >> "$XIPTV_LAB_TEST_LOG"
sleep 5
SH
chmod +x "$root/media-ndl-esplayer"
XIPTV_LAB_TIMEOUT_SEC=1 "$root/launcher"
test "$(cat "$root/activity")" = "$(printf 'ndl\nacb')"
echo "Native engine fallback mock tests OK"
