#!/usr/bin/env python3
"""Bundle only the optional network module's Buildroot runtime dependencies.

The main LG webOS2 ELF is intentionally NOT linked against these, to keep
the known-working NDL/SDL startup independent from curl and optional ACB.
Never package glibc, libSDL, NDL or firmware player APIs from the SDK.
"""
from pathlib import Path
import re, shutil, subprocess, sys

stage=Path(sys.argv[1])
sdk=Path(sys.argv[2])
network=stage/"libxiptv_network.so"
assert network.is_file()
system={
 "libc.so.6","libm.so.6","libpthread.so.0","libdl.so.2",
 "librt.so.1","libstdc++.so.6","libgcc_s.so.1",
 "libSDL2-2.0.so.0","libndl-directmedia2.so.1",
 "libAcbAPI.so.1","libplayerAPIs.so.1",
 "libwayland-client.so.0","libEGL.so.1","libGLESv2.so.2",
 "ld-linux.so.3"
}
def needs(path):
 result=subprocess.check_output(["readelf","-d",str(path)],text=True)
 return re.findall(r"\(NEEDED\).*Shared library: \[([^\]]+)\]",result)
def find_lib(name):
 hits=list(sdk.rglob(name))
 hits=[p for p in hits if p.is_file()]
 if not hits:
  raise SystemExit("SDK library missing: "+name)
 # Prefer the target sysroot over host-side support tools.
 hits.sort(key=lambda p:(0 if "sysroot" in str(p) else 1,len(str(p))))
 return hits[0]
pending=needs(network)
visited=set()
while pending:
 name=pending.pop(0)
 if name in visited or name in system:continue
 visited.add(name)
 lib=find_lib(name)
 destination=stage/name
 shutil.copyfile(lib,destination)
 print("Bundled optional dependency:",name,"bytes",destination.stat().st_size)
 pending.extend(needs(destination))
print("Optional network runtime dependencies:",sorted(visited))
