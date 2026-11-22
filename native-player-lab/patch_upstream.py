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
 if text.count(old)!=1 or text.count(title)!=1:raise SystemExit("Upstream changed: "+relative)
 text=text.replace(old,new,1).replace(title,'VERSION "0.1.0"\n        '+newtitle,1)
 f.write_text(text,encoding="utf-8")
print("Native lab ID isolated; production Android and webOS unchanged")
