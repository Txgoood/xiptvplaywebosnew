#!/usr/bin/env python3
from pathlib import Path
import sys
root=Path(sys.argv[1]); folder=root/"media"/"smp"/"acb"
def modify(relative,old,new):
 p=root/relative;s=p.read_text()
 if s.count(old)!=1:raise SystemExit("Upstream layout changed: "+relative)
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
add_executable(media-lab-auto
        auto_entry.c
        ndl_entry.c
        acb_entry.c
        ../../ndl/esplayer/esplayer.c
        acb_plane.c)
target_compile_definitions(media-lab-auto PRIVATE ACB_ATTACH_SINK_EARLY=1)
target_include_directories(media-lab-auto SYSTEM PRIVATE
        @{ACBAPI_INCLUDE_DIRS} @{NDL_DM2_INCLUDE_DIRS})
target_include_directories(media-lab-auto PRIVATE ../../ndl/esplayer)
target_link_directories(media-lab-auto PRIVATE @{ACBAPI_LIBRARY_DIRS})
target_link_libraries(media-lab-auto PRIVATE
        media-smp-common-legacy-nouserdata media-common-sdl
        @{ACBAPI_LIBRARIES} @{NDL_DM2_LIBRARIES})
set_target_properties(media-lab-auto PROPERTIES
        INSTALL_RPATH "$ORIGIN"
        BUILD_WITH_INSTALL_RPATH TRUE)
'''.replace("@{",chr(36)+"{")
cmake=folder/"CMakeLists.txt";cmake.write_text(cmake.read_text()+extra)
(folder/"auto_entry.c").write_bytes(Path(__file__).with_name("inprocess_auto.c").read_bytes())
print("Prepared combined native in-process motor")
