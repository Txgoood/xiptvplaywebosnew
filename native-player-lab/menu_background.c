/*
 * Native Lab v0.5.0: NDL-backed menu compositor.
 * Uses the same es_file + esplayer + sdl_shell sequence as the confirmed
 * NDL Build #21. Keeps a 10-second, locally packaged H264/AAC menu loop
 * playing underneath optional SDL UI rectangles.
 */
#include "menu_background.h"
#include "es_file.h"
#include "esplayer.h"
#include "pacer.h"
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#define LOOP_NS (10LL * 1000000000LL)
static esplayer *player;
static es_file *video,*audio;
static es_sample next_video,next_audio;
static bool hv,ha,loaded;
static int64_t origin,offset;
static void logphase(const char *name){fprintf(stderr,"[menu-ndl] %s\n",name);fflush(stderr);}
static void asset(char *dst,size_t cap,const char *name){
 char path[PATH_MAX];ssize_t n=readlink("/proc/self/exe",path,sizeof(path)-1);
 if(n<=0){snprintf(dst,cap,"%s",name);return;}
 path[n]=0;char *slash=strrchr(path,'/');
 if(slash)*slash=0;
 snprintf(dst,cap,"%s/%s",path,name);
}
bool ndl_menu_start(sdl_shell *shell){
 char vp[PATH_MAX],ap[PATH_MAX];asset(vp,sizeof(vp),"menu.h264");asset(ap,sizeof(ap),"menu.aac");
 video=es_file_open_h264(vp,25,1);
 audio=es_file_open_adts(ap);
 if(!video||!audio){logphase("MEDIA_FILES_MISSING");goto fail;}
 logphase("MEDIA_FILES_OK");
 if(!sdl_shell_preinit()||!sdl_shell_open_window(shell,"XIPTV NDL Menu")){
  logphase("SDL_OPEN_FAIL");goto fail;
 }
 sdl_shell_present_transparent(shell);
 logphase("SDL_WINDOW_OK");
 const char *appid=getenv("APPID");
 if(!appid||!appid[0])appid="com.xiptvplay.playerlab.unified";
 player=esplayer_create(appid);
 if(!player){logphase("ESPLAYER_CREATE_FAIL");goto fail;}
 esplayer_params params={.app_id=appid,.video_width=640,.video_height=360,
    .video_fps_num=25,.video_fps_den=1,
    .audio_channels=es_file_channels(audio),
    .audio_sample_rate=es_file_sample_rate(audio)};
 if(!esplayer_load(player,&params,shell->display_width,shell->display_height)){
  logphase("ESPLAYER_LOAD_FAIL");goto fail;
 }
 loaded=true;origin=0;offset=0;
 hv=es_file_next(video,&next_video);ha=es_file_next(audio,&next_audio);
 logphase("MENU_NDL_READY");
 return true;
fail:
 ndl_menu_stop(shell);
 return false;
}
void ndl_menu_tick(void){
 if(!player||!loaded)return;
 for(int i=0;i<8;i++){
  if(!hv&&!ha){
   offset+=LOOP_NS;
   es_file_rewind(video);es_file_rewind(audio);
   hv=es_file_next(video,&next_video);ha=es_file_next(audio,&next_audio);
   if(!hv&&!ha){logphase("MENU_SAMPLE_LOOP_FAILED");break;}
  }
  bool v=hv&&(!ha||next_video.pts_ns<=next_audio.pts_ns);
  es_sample *sample=v?&next_video:&next_audio;
  const int64_t pts=offset+sample->pts_ns;
  if(origin!=0 && pacer_now_ns()<origin+pts)break;
  esplayer_feed_result rc=esplayer_feed(player,sample->data,sample->size,pts,
                  v?ESPLAYER_STREAM_VIDEO:ESPLAYER_STREAM_AUDIO);
  if(rc==ESPLAYER_FEED_BUFFER_FULL)break;
  if(rc!=ESPLAYER_FEED_OK){logphase("MENU_FEED_FAILED");break;}
  if(origin==0){origin=pacer_now_ns()-pts;logphase("MENU_FIRST_FEED_ACCEPTED");}
  if(v)hv=es_file_next(video,&next_video);
  else ha=es_file_next(audio,&next_audio);
 }
}
void ndl_menu_stop(sdl_shell *shell){
 if(player){
  if(loaded)esplayer_unload(player);
  esplayer_destroy(player);player=NULL;
 }
 loaded=false;
 if(video){es_file_close(video);video=NULL;}
 if(audio){es_file_close(audio);audio=NULL;}
 if(shell&&shell->window)sdl_shell_close(shell);
}
