#!/usr/bin/env python3
from pathlib import Path
import sys
root=Path(sys.argv[1])
jobs=[
 ("media/ndl/esplayer/CMakeLists.txt","org.webosbrew.sample.media.ndl.esplayer","com.xiptvplay.playerlab.ndl",'TITLE "NDL Esplayer','TITLE "XIPTV Player Lab NDL'),
 ("media/smp/acb/CMakeLists.txt","org.webosbrew.sample.media.smp.acb.","com.xiptvplay.playerlab.acb.",'TITLE "SMP ACB ','TITLE "XIPTV Player Lab ACB ')
]
for relative,old,new,title,newtitle in jobs:
 f=root/relative
 text=f.read_text(encoding="utf-8")
 if text.count(old)!=1 or text.count(title)!=1:raise SystemExit("Upstream CMake layout changed: "+relative)
 text=text.replace(old,new,1).replace(title,'VERSION "0.2.0"\n        '+newtitle,1)
 f.write_text(text,encoding="utf-8")
# First-frame events are mandatory: successful feed/Play() is not rendered picture.
# The marker is per-run; the launcher checks it and cleans up before switching.
changes=[
 ("media/ndl/esplayer/esplayer.c",
  'fprintf(stderr, "[ndl] event %s\\n", event_name(event));',
  '''fprintf(stderr, "[ndl] event %s\\n", event_name(event));
    if (event == NDL_ESP_FIRST_FRAME_PRESENTED) {
        const char *mark = getenv("XIPTV_LAB_READY_MARKER");
        if (mark && mark[0] == '/' && strlen(mark) < 256) {
            FILE *f = fopen(mark, "w");
            if (f) { fputs("ok", f); fclose(f); }
        }
    }'''),
 ("media/smp/common/smp_player.c",
  'case SMP_EVENT_FRAMEREADY: {',
  '''case SMP_EVENT_FRAMEREADY: {
            const char *mark = getenv("XIPTV_LAB_READY_MARKER");
            if (mark && mark[0] == '/' && strlen(mark) < 256) {
                FILE *f = fopen(mark, "w");
                if (f) { fputs("ok", f); fclose(f); }
            }''')
]
for relative,old,new in changes:
 f=root/relative
 text=f.read_text(encoding="utf-8")
 if text.count(old)!=1:raise SystemExit("Upstream C callback layout changed: "+relative)
 f.write_text(text.replace(old,new,1),encoding="utf-8")
print("Native lab v0.2.0 isolated test app IDs and first-frame event signals applied")
