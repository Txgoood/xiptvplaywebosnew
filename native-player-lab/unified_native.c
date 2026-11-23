/*
 * XIPTV Play Native HLS Lab v0.5.3 — one LG webOS 2 native ARM app.
 * SDL remote-only catalogue, phone one-time account pairing, NDL->ACB playback.
 * No shell, browser bridge, fork/exec, or embedded upstream credentials.
 * This is an experimental 8 second clip player, not a complete IPTV player.
 */
#include <SDL.h>
#ifdef HAVE_SDL_WEBOS
#include <SDL_webOS.h>
#endif
#include <dlfcn.h>
#include <ctype.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "sdl_shell.h"
#include "app_launch.h"
#include "menu_background.h"
#define ROOT "https://xiptvplay-native-lab.onrender.com"
#define MAX_BODY (4*1024*1024)
#define RESULT_MAX 18
extern int xiptv_ndl_main(int,char**);




extern volatile sig_atomic_t xiptv_ndl_first_frame;

typedef struct {char server[260],username[180],password[180];} credentials;
typedef struct {char id[20],title[150];} movie;
static credentials account;
static movie movies[RESULT_MAX];
static int movie_count=0,selected=0;
static char query[90]="";
static char pair_token[60]="",pair_code[20]="";
static char message[256]="";
static sdl_shell shell;
static FILE *bootlog=NULL;
static void trace(const char *what){if(bootlog){fprintf(bootlog,"%s\n",what);fflush(bootlog);}fprintf(stderr,"[unified] %s\n",what);}
static int mode=0; /* 0 pair, 1 catalogue, 2 keyboard */
static int focus=0,keyboard_cursor=0;
static char account_file[PATH_MAX];
static const char *keys="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -<.";
static const char *alphabet=" ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:/.-_@";
static const uint8_t glyphs[][7]={
/* space */{0,0,0,0,0,0,0},
/* A-Z */
{14,17,17,31,17,17,17},{30,17,17,30,17,17,30},
{14,17,16,16,16,17,14},{30,17,17,17,17,17,30},
{31,16,16,30,16,16,31},{31,16,16,30,16,16,16},
{14,17,16,23,17,17,14},{17,17,17,31,17,17,17},
{31,4,4,4,4,4,31},{7,2,2,2,18,18,12},
{17,18,20,24,20,18,17},{16,16,16,16,16,16,31},
{17,27,21,21,17,17,17},{17,25,21,19,17,17,17},
{14,17,17,17,17,17,14},{30,17,17,30,16,16,16},
{14,17,17,17,21,18,13},{30,17,17,30,20,18,17},
{15,16,16,14,1,1,30},{31,4,4,4,4,4,4},
{17,17,17,17,17,17,14},{17,17,17,17,17,10,4},
{17,17,17,21,21,21,10},{17,17,10,4,10,17,17},
{17,17,10,4,4,4,4},{31,1,2,4,8,16,31},
/* 0-9 */
{14,17,19,21,25,17,14},{4,12,4,4,4,4,14},
{14,17,1,2,4,8,31},{30,1,1,14,1,1,30},
{2,6,10,18,31,2,2},{31,16,16,30,1,1,30},
{14,16,16,30,17,17,14},{31,1,2,4,8,8,8},
{14,17,17,14,17,17,14},{14,17,17,15,1,1,14},
/* - / . : _ @ < > */
{0,0,0,31,0,0,0},{1,2,4,8,16,0,0},
{0,0,0,0,0,12,12},{0,12,12,0,12,12,0},
{0,0,0,0,0,0,31},{14,17,23,21,23,16,14},
{2,4,8,16,8,4,2},{8,4,2,1,2,4,8}
};
static int glyph_index(char c){
 if(c>='a'&&c<='z')c-=32;
 if(c==' ')return 0;
 if(c>='A'&&c<='Z')return 1+c-'A';
 if(c>='0'&&c<='9')return 27+c-'0';
 const char *extra="-/. :_@<>";
 for(int i=0;extra[i];i++)if(extra[i]==c){
  if(c=='-')return 37;if(c=='/')return 38;
  if(c=='.')return 39;if(c==':')return 40;
  if(c=='_')return 41;if(c=='@')return 42;
  if(c=='<')return 43;if(c=='>')return 44;
 }
 return 39;
}
static void rect(int x,int y,int w,int h,int red,int green,int blue){
 SDL_Rect r={x,y,w,h};
 SDL_SetRenderDrawColor(shell.renderer,red,green,blue,255);
 SDL_RenderFillRect(shell.renderer,&r);
}
static void draw(int x,int y,const char *text,int scale,int r,int g,int b){
 for(int i=0;text[i]&&i<90;i++){
  int k=glyph_index(text[i]);
  for(int row=0;row<7;row++)
   for(int col=0;col<5;col++)
    if(glyphs[k][row]&(1<<(4-col)))rect(x+i*6*scale+col*scale,y+row*scale,scale,scale,r,g,b);
 }
}
static void field(int y,const char *caption,int active){
 rect(34,y,980,47,active?20:15,active?105:51,active?121:72);
 draw(54,y+9,caption,3,240,245,250);
}
static void present(void){
 if(!shell.renderer)return;
 /* The menu owns the SDL surface only after the NDL plane is released. */
 SDL_SetRenderDrawBlendMode(shell.renderer,SDL_BLENDMODE_NONE);
 int w=shell.display_width,h=shell.display_height;
 SDL_SetRenderDrawColor(shell.renderer,12,28,45,255);
 if(SDL_RenderClear(shell.renderer)!=0){
  static bool logged;
  if(!logged){trace(SDL_GetError());logged=true;}
  return;
 }
 rect(0,0,w,94,13,42,60);
 draw(28,23,"XIPTV NATIVE HLS LAB  V0.5.3",3,241,248,250);
 if(mode==0){
  draw(40,126,"TEK SEFERLIK HESAP BAGLAMA",3,228,235,251);
  draw(40,180,"TELEFON TARAYICISINDA AC",3,167,212,234);
  draw(40,228,"XIPTVPLAY-NATIVE-LAB.ONRENDER.COM/PAIR",2,239,229,165);
  draw(40,280,"TV ESLESTIRME KODU",3,167,212,234);
  draw(40,325,*pair_code?pair_code:"KOD BEKLENIYOR",5,251,238,161);
  field(425,*pair_token?"OK  BAGLANTIYI KONTROL ET":"OK  ESLESTIRME KODU AL",focus==0);
  field(484,"ASAGI  YENI KOD AL",focus==1);
 }else if(mode==2){
  draw(40,126,"FILM ADINI YAZ  OK HARF SEC  BACK BITIR",3,231,234,250);
  rect(36,180,980,48,16,64,78);
  draw(55,191,query,3,250,253,246);
  for(int i=0;keys[i];i++){
   int col=i%10,row=i/10,x=48+col*94,y=280+row*74;
   rect(x-5,y-5,83,57,i==keyboard_cursor?17:24,i==keyboard_cursor?116:51,i==keyboard_cursor?121:71);
   char letter[2]={keys[i],0};draw(x+19,y+10,letter,4,251,253,246);
  }
  draw(38,640,"< SIL   - BOSLUK   BACK ARA",3,178,212,225);
 }else{
  draw(38,118,"FILM ARAMA",3,204,230,250);
  field(160,query[0]?query:"FILM ADI GIR",focus==0);
  field(219,"FILM ARA  OK",focus==1);
  int top=281;
  for(int i=0;i<movie_count&&i<8;i++){
   if(i==selected&&focus==2)rect(30,top+i*43,1050,41,15,110,125);
   char temp[96];snprintf(temp,sizeof(temp),"%02d  %.75s",i+1,movies[i].title);
   draw(52,top+i*43+7,temp,2,i==selected?255:207,235,244);
  }
  field(650,"OYNAT  OK",focus==3);
  draw(38,710,"GERI: ARAMAYA DON   ASAGI: SONRAKI",2,141,191,218);
 }
 rect(0,h-80,w,78,14,41,58);
 draw(24,h-58,message,2,240,238,176);
 SDL_RenderPresent(shell.renderer);
 static bool logged;
 if(!logged){trace("SDL MENU FRAME SUBMITTED");logged=true;}
}

static bool open_menu_window(void){
 if(shell.renderer)return true;
 if(sdl_shell_preinit()&&sdl_shell_open_window(&shell,"XIPTV Native Menu"))return true;
 trace(SDL_GetError());
 sdl_shell_close(&shell);
 return false;
}

/* Only NDL + SDL + libc are required at process startup. libcurl/ACB are
   separately loaded when pairing, searching or playback actually needs them. */
static void *net_handle=NULL,*acb_handle=NULL;
static int (*net_http)(const char*,const char*,char*,size_t,int)=NULL;
static int (*net_fetch)(int,char**,char*,size_t,char*,size_t)=NULL;
static void (*net_cleanup)(const char*,const char*)=NULL;
static int (*acb_play)(int,char**)=NULL;
static volatile sig_atomic_t *acb_first=NULL;
static int open_plugin(const char *filename,void **handle){
 if(*handle)return 1;
 char path[PATH_MAX],full[PATH_MAX];
 ssize_t n=readlink("/proc/self/exe",path,sizeof(path)-1);
 if(n<=0){snprintf(message,sizeof(message),"EXE YOLU OKUNAMADI");return 0;}
 path[n]=0;
 char *slash=strrchr(path,'/');
 if(!slash){snprintf(message,sizeof(message),"UYGULAMA YOLU HATALI");return 0;}
 *slash=0;
 if(strlen(path)+strlen(filename)+2>=sizeof(full))return 0;
 snprintf(full,sizeof(full),"%s/%s",path,filename);
 *handle=dlopen(full,RTLD_NOW|RTLD_LOCAL);
 if(!*handle){
  const char *reason=dlerror();
  snprintf(message,sizeof(message),"MODUL ACILAMADI: %.130s",reason?reason:filename);
  trace(message);
  return 0;
 }
 return 1;
}
static int network_ready(void){
 if(net_http&&net_fetch&&net_cleanup)return 1;
 if(!open_plugin("libxiptv_network.so",&net_handle))return 0;
 net_http=(int(*)(const char*,const char*,char*,size_t,int))dlsym(net_handle,"xiptv_net_http");
 net_fetch=(int(*)(int,char**,char*,size_t,char*,size_t))dlsym(net_handle,"lab_fetch_launch");
 net_cleanup=(void(*)(const char*,const char*))dlsym(net_handle,"lab_fetch_cleanup");
 if(!net_http||!net_fetch||!net_cleanup){
  snprintf(message,sizeof(message),"AG MODULUNDE FONKSIYON EKSIK");
  return 0;
 }
 return 1;
}
static int http(const char *url,const char *data,char *out,size_t cap,int timeout){
 if(!network_ready())return 0;
 int result=net_http(url,data,out,cap,timeout);
 if(result==1)return 1;
 if(result<=-1000)snprintf(message,sizeof(message),"SUNUCU HTTP %d",-result-1000);
 else snprintf(message,sizeof(message),"HTTPS HATA KODU %d",-result);
 return 0;
}
static int play_acb_optional(int argc,char **argv){
 if(!open_plugin("libxiptv_acb.so",&acb_handle))return 0;
 acb_play=(int(*)(int,char**))dlsym(acb_handle,"xiptv_acb_main");
 acb_first=(volatile sig_atomic_t*)dlsym(acb_handle,"xiptv_smp_first_frame");
 if(!acb_play){snprintf(message,sizeof(message),"ACB GIRIS FONKSIYONU EKSIK");return 0;}
 if(acb_first)*acb_first=0;
 int rc=acb_play(argc,argv);
 return acb_first?(*acb_first!=0):(rc==0);
}
static int value(const char *json,const char *key,char *dst,size_t len){
 char pattern[80];snprintf(pattern,sizeof(pattern),"\"%s\":\"",key);
 const char *start=strstr(json,pattern);if(!start)return 0;
 start+=strlen(pattern);size_t n=0;
 while(*start&&*start!='"'&&n+1<len){
  if(*start=='\\'&&start[1]){
   start++;
   if(*start=='n'||*start=='r'||*start=='t'){dst[n++]=' ';start++;continue;}
  }
  dst[n++]=*start++;
 }
 dst[n]=0;return *start=='"';
}
static void escape(const char *s,char *out,size_t limit){
 size_t n=0;for(int i=0;s[i]&&n+6<limit;i++){
  unsigned char c=s[i];
  if(c=='"'||c=='\\'){out[n++]='\\';out[n++]=c;}
  else if(c<32){out[n++]=' ';}
  else out[n++]=c;
 }out[n]=0;
}
static void account_path(void){
 const char *home=getenv("HOME");
 if(!home||home[0]!='/')home="/tmp";
 snprintf(account_file,sizeof(account_file),"%s/.xiptv-native-lab-account",home);
}
static int load_account(void){
 account_path();FILE *f=fopen(account_file,"rb");if(!f)return 0;
 int ok=fgets(account.server,sizeof(account.server),f)&&fgets(account.username,sizeof(account.username),f)&&fgets(account.password,sizeof(account.password),f);
 fclose(f);
 account.server[strcspn(account.server,"\r\n")]=0;
 account.username[strcspn(account.username,"\r\n")]=0;
 account.password[strcspn(account.password,"\r\n")]=0;
 return ok&&account.server[0]&&account.username[0]&&account.password[0];
}
static void save_account(void){
 account_path();FILE *f=fopen(account_file,"wb");if(!f)return;
 chmod(account_file,0600);
 fprintf(f,"%s\n%s\n%s\n",account.server,account.username,account.password);
 fclose(f);
}
static int pairing_start(void){
 char response[512];if(!http(ROOT "/pair/start",NULL,response,sizeof(response),20))return 0;
 if(!value(response,"token",pair_token,sizeof(pair_token))||
    !value(response,"code",pair_code,sizeof(pair_code)))return 0;
 snprintf(message,sizeof(message),"TELEFONDA LINKI AC VE KODU GIR");return 1;
}
static int pairing_check(void){
 if(strlen(pair_token)!=48)return pairing_start();
 char url[256],response[2000];snprintf(url,sizeof(url),ROOT "/pair/status/%s",pair_token);
 if(!http(url,NULL,response,sizeof(response),20))return 0;
 if(strstr(response,"\"ready\":false")){snprintf(message,sizeof(message),"HENUZ BAGLANTI GIRILMEDI");return 0;}
 if(!value(response,"serverUrl",account.server,sizeof(account.server))||
    !value(response,"username",account.username,sizeof(account.username))||
    !value(response,"password",account.password,sizeof(account.password)))return 0;
 save_account();mode=1;focus=0;
 snprintf(message,sizeof(message),"HESAP KAYDEDILDI. FILM ARAYABILIRSIN");return 1;
}
static int search_movies(void){
 if(strlen(query)<2){snprintf(message,sizeof(message),"EN AZ 2 HARF YAZ");return 0;}
 char srv[540],user[380],pass[380],q[200],body[1700];
 escape(account.server,srv,sizeof(srv));escape(account.username,user,sizeof(user));
 escape(account.password,pass,sizeof(pass));escape(query,q,sizeof(q));
 snprintf(body,sizeof(body),"{\"serverUrl\":\"%s\",\"username\":\"%s\",\"password\":\"%s\",\"query\":\"%s\"}",srv,user,pass,q);
 char *resp=malloc(MAX_BODY);if(!resp)return 0;
 movie_count=0;selected=0;snprintf(message,sizeof(message),"FILM KATALOGU ARANIYOR");present();
 int ok=http(ROOT "/search",body,resp,MAX_BODY,45);
 if(ok){
  const char *cur=resp;
  while(movie_count<RESULT_MAX&&(cur=strstr(cur,"\"id\":\""))){
   char id[32],title[200];
   if(!value(cur,"id",id,sizeof(id))||!value(cur,"title",title,sizeof(title)))break;
   if(strlen(id)<15){
    snprintf(movies[movie_count].id,sizeof(movies[movie_count].id),"%s",id);
    snprintf(movies[movie_count].title,sizeof(movies[movie_count].title),"%s",title);
    movie_count++;
   }
   cur+=6;
  }
  snprintf(message,sizeof(message),"%d FILM BULUNDU",movie_count);
 }
 free(resp);focus=movie_count?2:0;return ok;
}
static int play_movie(void){
 if(movie_count<1||selected>=movie_count){snprintf(message,sizeof(message),"ONCE FILM SEC");return 0;}
 char srv[540],user[380],pass[380],body[1700];
 escape(account.server,srv,sizeof(srv));escape(account.username,user,sizeof(user));escape(account.password,pass,sizeof(pass));
 snprintf(body,sizeof(body),"{\"serverUrl\":\"%s\",\"username\":\"%s\",\"password\":\"%s\",\"id\":\"%s\",\"kind\":\"movie\",\"extension\":\"m3u8\"}",srv,user,pass,movies[selected].id);
 char response[1200],video[250],audio[250];
 snprintf(message,sizeof(message),"FILM H264 AAC HAZIRLANIYOR");present();
 if(!http(ROOT "/prepare",body,response,sizeof(response),115))return 0;
 if(!value(response,"videoUrl",video,sizeof(video))||!value(response,"audioUrl",audio,sizeof(audio))){
  snprintf(message,sizeof(message),"SUNUCU FILM LINKI VERMEDI");return 0;
 }
 /* Reuse the v0.2.1 first-frame-tested NDL/ACB entrypoints in this process. */
 char packed[640];snprintf(packed,sizeof(packed),"{\"videoUrl\":\"%s\",\"audioUrl\":\"%s\"}",video,audio);
 char *argv[]={"media-lab-unified",packed,NULL};
 char vpath[PATH_MAX]={0},apath[PATH_MAX]={0};
 snprintf(message,sizeof(message),"GERCEK FILM INDIRILIYOR");present();
 int remote=network_ready()?net_fetch(2,argv,vpath,sizeof(vpath),apath,sizeof(apath)):-1;
 if(remote!=1){snprintf(message,sizeof(message),"INDIRME BASARISIZ. HATA KODU %d",remote);return 0;}
 /* Native NDL opens its own SDL window; close menu before handing video plane over. */
 sdl_shell_close(&shell);
 char *playargs[]={"media-lab-unified","--video",vpath,"--audio",apath,"--fps","25","--size","640x360",NULL};
 xiptv_ndl_first_frame=0;
 int result=xiptv_ndl_main(9,playargs);
 int worked=xiptv_ndl_first_frame;
 if(!worked){
  worked=play_acb_optional(9,playargs);
 }
 if(net_cleanup)net_cleanup(vpath,apath);
 if(!open_menu_window())return -1;
 snprintf(message,sizeof(message),worked?"VIDEO GOSTERILDI. MENUYE DONULDU":"GIRIS CALISTI ANCAK ILK GORUNTU YOK");
 (void)result;return worked;
}
static SDL_Keycode remote_key(SDL_Keysym key){
 switch(key.scancode){
  case SDL_SCANCODE_RETURN:
  case SDL_SCANCODE_RETURN2:
  case SDL_SCANCODE_KP_ENTER:
  case SDL_SCANCODE_SELECT: return SDLK_RETURN;
  case SDL_SCANCODE_UP: return SDLK_UP;
  case SDL_SCANCODE_DOWN: return SDLK_DOWN;
  case SDL_SCANCODE_LEFT: return SDLK_LEFT;
  case SDL_SCANCODE_RIGHT: return SDLK_RIGHT;
  case SDL_SCANCODE_ESCAPE:
  case SDL_SCANCODE_AC_BACK:
#ifdef HAVE_SDL_WEBOS
  case SDL_WEBOS_SCANCODE_BACK:
  case SDL_WEBOS_SCANCODE_EXIT:
#endif
   return SDLK_ESCAPE;
  default: return key.sym==SDLK_SELECT||key.sym==SDLK_RETURN2?SDLK_RETURN:key.sym;
 }
}
static void key_press(SDL_Keycode key){
 if(mode==0){
  if(key==SDLK_DOWN||key==SDLK_UP){focus=1-focus;return;}
  if(key==SDLK_RETURN||key==SDLK_KP_ENTER){
   bool new_code=focus||!pair_token[0];
   snprintf(message,sizeof(message),new_code?"KOD HAZIRLANIYOR":"BAGLANTI KONTROL EDILIYOR");
   present();
   if(new_code)pairing_start();else pairing_check();
  }
  return;
 }
 if(mode==2){
  int n=(int)strlen(keys);
  if(key==SDLK_UP)keyboard_cursor=(keyboard_cursor+10*(n/10)-10)%n;
  else if(key==SDLK_DOWN)keyboard_cursor=(keyboard_cursor+10)%n;
  else if(key==SDLK_LEFT)keyboard_cursor=(keyboard_cursor+n-1)%n;
  else if(key==SDLK_RIGHT)keyboard_cursor=(keyboard_cursor+1)%n;
  else if(key==SDLK_RETURN||key==SDLK_KP_ENTER){
   int z=strlen(query);char k=keys[keyboard_cursor];
   if(k=='<'){if(z)query[z-1]=0;}
   else if(z+1<(int)sizeof(query)){query[z]=k=='-'?' ':k;query[z+1]=0;}
  }else if(key==SDLK_ESCAPE||key==SDLK_BACKSPACE){mode=1;focus=1;}
  return;
 }
 if(key==SDLK_UP){if(focus==2&&selected>0)selected--;else focus=(focus+3)%4;}
 else if(key==SDLK_DOWN){if(focus==2&&selected+1<movie_count)selected++;else focus=(focus+1)%4;}
 else if(key==SDLK_LEFT&&focus==2&&selected>0)selected--;
 else if(key==SDLK_RIGHT&&focus==2&&selected+1<movie_count)selected++;
 else if(key==SDLK_RETURN||key==SDLK_KP_ENTER){
  if(focus==0){mode=2;keyboard_cursor=0;}
  else if(focus==1)search_movies();
  else if(focus==2)focus=3;
  else if(focus==3)play_movie();
 }else if(key==SDLK_BACKSPACE||key==SDLK_ESCAPE){focus=0;}
}
int main(int argc,char **argv){
 (void)argc;(void)argv;
 bootlog=fopen("/tmp/xiptv-native-unified-boot.log","w");
 trace("BOOT ENTERED");
 /* Use the known-good NDL startup, then release its fullscreen plane while
    retaining the original SDL window and its input focus. */
 xiptv_ndl_first_frame=0;
 bool splash=ndl_menu_start(&shell);
 if(!open_menu_window()){
  if(bootlog)fclose(bootlog);
  return 12;
 }
 Uint32 splash_started=SDL_GetTicks();
 mode=load_account()?1:0;
 snprintf(message,sizeof(message),mode?"FILM ADI GIR VE ARA":"OK BASARAK ESLESTIRME KODU AL");
 if(!splash)present();
 int running=1;
 while(running){
  if(splash){
   ndl_menu_tick();
   if(xiptv_ndl_first_frame||SDL_GetTicks()-splash_started>=2500){
    trace(xiptv_ndl_first_frame?"NDL FIRST FRAME REPORTED":"NDL FIRST FRAME TIMEOUT");
    ndl_menu_stop(NULL);
    splash=false;
    trace("NDL SPLASH PLANE RELEASED");
    present();
   }
  }
  SDL_Event event;
  while(SDL_PollEvent(&event)){
   if(event.type==SDL_QUIT){running=0;break;}
   if(event.type==SDL_WINDOWEVENT &&
      (event.window.event==SDL_WINDOWEVENT_FOCUS_GAINED||
       event.window.event==SDL_WINDOWEVENT_FOCUS_LOST)){
    trace(event.window.event==SDL_WINDOWEVENT_FOCUS_GAINED?"SDL FOCUS GAINED":"SDL FOCUS LOST");
   }
   if(event.type==SDL_KEYDOWN&&!event.key.repeat){
    SDL_Keycode key=remote_key(event.key.keysym);
    char detail[128];
    snprintf(detail,sizeof(detail),"SDL KEY sym=%d scan=%d mapped=%d",
             (int)event.key.keysym.sym,(int)event.key.keysym.scancode,(int)key);
    trace(detail);
    if(mode!=2&&(key==SDLK_ESCAPE||key==SDLK_BACKSPACE)){running=0;break;}
    if(splash){
     ndl_menu_stop(NULL);
     splash=false;
     trace("NDL SPLASH DISMISSED BY KEY");
     present();
    }
    key_press(key);
    if(!shell.renderer){running=0;break;}
   }
   if(event.type==SDL_TEXTINPUT&&mode==2){
    size_t n=strlen(query);
    for(int k=0;event.text.text[k]&&n+1<sizeof(query);k++){
     unsigned char c=event.text.text[k];
     if(c>=32&&c<127)query[n++]=(char)toupper(c);
    }
    query[n]=0;
   }
  }
  if(running&&!splash)present();
  SDL_Delay(24);
 }
 ndl_menu_stop(&shell);
 if(acb_handle)dlclose(acb_handle);
 if(net_handle)dlclose(net_handle);
 trace("EXIT CLEAN");
 if(bootlog)fclose(bootlog);
 return 0;
}
