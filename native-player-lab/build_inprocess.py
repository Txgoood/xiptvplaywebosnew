#!/usr/bin/env python3
from pathlib import Path
import sys
root=Path(sys.argv[1]);folder=root/"media"/"smp"/"acb"
def modify(relative,old,new):
 p=root/relative;s=p.read_text()
 if s.count(old)!=1:raise SystemExit("Unexpected upstream code: "+relative+" / "+old)
 p.write_text(s.replace(old,new,1))
modify("media/ndl/esplayer/esplayer.c","#include <pthread.h>","#include <pthread.h>\n#include <signal.h>\nvolatile sig_atomic_t xiptv_ndl_first_frame=0;")
modify("media/ndl/esplayer/esplayer.c","if (event == NDL_ESP_END_OF_STREAM) {","if (event == NDL_ESP_FIRST_FRAME_PRESENTED) xiptv_ndl_first_frame=1;\n    if (event == NDL_ESP_END_OF_STREAM) {")
modify("media/smp/common/smp_player.c","#include <pthread.h>","#include <pthread.h>\n#include <signal.h>\nvolatile sig_atomic_t xiptv_smp_first_frame=0;")
modify("media/smp/common/smp_player.c","case SMP_EVENT_FRAMEREADY: {","case SMP_EVENT_FRAMEREADY: {\n            xiptv_smp_first_frame=1;")
for relative,dest,entry,flag in [
 ("media/ndl/esplayer/main.c","ndl_entry.c","xiptv_ndl_main","xiptv_ndl_first_frame"),
 ("media/smp/acb/main.c","acb_entry.c","xiptv_acb_main","xiptv_smp_first_frame")]:
 text=(root/relative).read_text()
 if text.count("int main(int argc, char *argv[])")!=1 or text.count("return exit_code;")!=1:
  raise SystemExit("Unsupported upstream entry: "+relative)
 text=text.replace("int main(int argc, char *argv[])", "int "+entry+"(int argc, char *argv[])",1)
 text="#include <signal.h>\nextern volatile sig_atomic_t "+flag+";\n"+text
 text=text.replace("return exit_code;", "return exit_code ? exit_code : ("+flag+" ? 0 : 3);",1)
 (folder/dest).write_text(text)
extra='''
# In-process fallback; no child processes, native app has one decoder session.
webos_userland_provide(libndl-directmedia2 NDL_DM2_LIBRARIES NDL_DM2_INCLUDE_DIRS)
pkg_check_modules(LABCURL REQUIRED libcurl)
add_executable(media-lab-auto
        auto_entry.c source_fetch.c
        ndl_entry.c acb_entry.c
        ../../ndl/esplayer/esplayer.c acb_plane.c)
target_compile_definitions(media-lab-auto PRIVATE ACB_ATTACH_SINK_EARLY=1)
target_include_directories(media-lab-auto SYSTEM PRIVATE
        @{ACBAPI_INCLUDE_DIRS} @{NDL_DM2_INCLUDE_DIRS} @{LABCURL_INCLUDE_DIRS})
target_include_directories(media-lab-auto PRIVATE ../../ndl/esplayer)
target_link_directories(media-lab-auto PRIVATE
        @{ACBAPI_LIBRARY_DIRS} @{LABCURL_LIBRARY_DIRS})
target_link_libraries(media-lab-auto PRIVATE
        media-smp-common-legacy-nouserdata media-common-sdl
        @{ACBAPI_LIBRARIES} @{NDL_DM2_LIBRARIES} @{LABCURL_LIBRARIES})
set_target_properties(media-lab-auto PROPERTIES
        INSTALL_RPATH "$ORIGIN"
        BUILD_WITH_INSTALL_RPATH TRUE)
'''.replace("@{",chr(36)+"{")
cmake=folder/"CMakeLists.txt";cmake.write_text(cmake.read_text()+extra)
base=Path(__file__).parent
(folder/"auto_entry.c").write_bytes((base/"inprocess_auto.c").read_bytes())
(folder/"source_fetch.c").write_bytes((base/"source_fetch.c").read_bytes())
(folder/"unified_native.c").write_bytes((base/"unified_native.c").read_bytes())
(folder/"menu_background.c").write_bytes((base/"menu_background.c").read_bytes())
(folder/"menu_background.h").write_bytes((base/"menu_background.h").read_bytes())
cmake.write_text(cmake.read_text()+'''
add_executable(media-lab-unified
        unified_native.c menu_background.c source_fetch.c
        ndl_entry.c acb_entry.c
        ../../ndl/esplayer/esplayer.c acb_plane.c)
target_compile_definitions(media-lab-unified PRIVATE ACB_ATTACH_SINK_EARLY=1)
target_include_directories(media-lab-unified SYSTEM PRIVATE
        @{ACBAPI_INCLUDE_DIRS} @{NDL_DM2_INCLUDE_DIRS} @{LABCURL_INCLUDE_DIRS})
target_include_directories(media-lab-unified PRIVATE ../../ndl/esplayer)
target_link_directories(media-lab-unified PRIVATE @{ACBAPI_LIBRARY_DIRS} @{LABCURL_LIBRARY_DIRS})
target_link_libraries(media-lab-unified PRIVATE
        media-smp-common-legacy-nouserdata media-common-sdl
        @{ACBAPI_LIBRARIES} @{NDL_DM2_LIBRARIES} @{LABCURL_LIBRARIES})
set_target_properties(media-lab-unified PROPERTIES INSTALL_RPATH "$ORIGIN" BUILD_WITH_INSTALL_RPATH TRUE)
'''.replace("@{",chr(36)+"{"))


(folder/"display_smoke.c").write_bytes((base/"display_smoke.c").read_bytes())
cmake.write_text(cmake.read_text()+'''
# Deliberately isolated from all media decoders and curl/network.
# Uses the same SDL shell implementation as v0.2.1 Build #5.
add_executable(media-lab-display-smoke display_smoke.c)
target_link_libraries(media-lab-display-smoke PRIVATE media-common-sdl)
set_target_properties(media-lab-display-smoke PROPERTIES
        INSTALL_RPATH "$ORIGIN"
        BUILD_WITH_INSTALL_RPATH TRUE)
''')

print("Single-process native motor with tokenized HTTPS H264/AAC feed prepared")
