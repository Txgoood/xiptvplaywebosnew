/*
 * XIPTV v0.3.0 — bounded, HTTPS-only fetch of authenticated short H264/AAC clips.
 * URLs are ephemeral bridge tokens, never the provider's username/password.
 * No arbitrary network URLs, redirects or persistent sensitive storage.
 */
#include <curl/curl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "app_launch.h"
#define LAB_VIDEO_PREFIX "https://xiptvplay-native-lab.onrender.com/media/"
#define LAB_VIDEO_SUFFIX "/video.h264"
#define LAB_AUDIO_SUFFIX "/audio.aac"
#define LAB_MAX_BYTES (8*1024*1024)
struct writer {FILE *file; size_t count;};
static int ishex(char c){return (c>='0'&&c<='9')||(c>='a'&&c<='f');}
static int token_from_url(const char *url,const char *suffix,char *token){
 size_t prefix=strlen(LAB_VIDEO_PREFIX),suff=strlen(suffix),len=strlen(url);
 if(len!=prefix+48+suff||strncmp(url,LAB_VIDEO_PREFIX,prefix)!=0||
    strcmp(url+prefix+48,suffix)!=0)return 0;
 for(size_t i=0;i<48;i++)if(!ishex(url[prefix+i]))return 0;
 memcpy(token,url+prefix,48);token[48]='\0';return 1;
}
static size_t sink(char *ptr,size_t size,size_t nmemb,void *ctx){
 struct writer *w=ctx;
 if(size&&nmemb>SIZE_MAX/size)return 0;
 size_t n=size*nmemb;
 if(n>LAB_MAX_BYTES-w->count)return 0;
 size_t written=fwrite(ptr,1,n,w->file);
 w->count+=written;
 return written;
}
static int fetch(const char *url,const char *out){
 CURL *c=curl_easy_init();if(!c)return 0;
 FILE *f=fopen(out,"wb");if(!f){curl_easy_cleanup(c);return 0;}
 struct writer w={f,0};
 curl_easy_setopt(c,CURLOPT_URL,url);
 curl_easy_setopt(c,CURLOPT_WRITEFUNCTION,sink);
 curl_easy_setopt(c,CURLOPT_WRITEDATA,&w);
 curl_easy_setopt(c,CURLOPT_TIMEOUT,65L);
 curl_easy_setopt(c,CURLOPT_CONNECTTIMEOUT,20L);
 curl_easy_setopt(c,CURLOPT_FOLLOWLOCATION,0L);
 curl_easy_setopt(c,CURLOPT_SSL_VERIFYPEER,1L);
 curl_easy_setopt(c,CURLOPT_SSL_VERIFYHOST,2L);
 curl_easy_setopt(c,CURLOPT_NOSIGNAL,1L);
 curl_easy_setopt(c,CURLOPT_PROTOCOLS,(long)CURLPROTO_HTTPS);
 curl_easy_setopt(c,CURLOPT_USERAGENT,"XIPTV-NativeLab/0.3");
 CURLcode error=curl_easy_perform(c);
 long status=0;curl_easy_getinfo(c,CURLINFO_RESPONSE_CODE,&status);
 fclose(f);curl_easy_cleanup(c);
 if(error!=CURLE_OK||status!=200||w.count<1024){
  fprintf(stderr,"[lab] media download failed code=%d http=%ld bytes=%lu\n",(int)error,status,(unsigned long)w.count);
  unlink(out);return 0;
 }
 return 1;
}
static int magic(const char *p,int video){
 unsigned char b[4]={0};FILE *f=fopen(p,"rb");if(!f)return 0;
 size_t n=fread(b,1,4,f);fclose(f);if(n<4)return 0;
 if(video)return b[0]==0&&b[1]==0&&((b[2]==1)||(b[2]==0&&b[3]==1));
 return b[0]==0xff&&(b[1]&0xf0)==0xf0;
}
#define LAB_PENDING "https://xiptvplay-native-lab.onrender.com/pending"
struct pending_response {char text[256];size_t count;};
static size_t pending_sink(char *ptr,size_t size,size_t nmemb,void *data){
 struct pending_response *p=data;
 if(size && nmemb>SIZE_MAX/size)return 0;
 size_t n=size*nmemb;
 if(n>sizeof(p->text)-1-p->count)return 0;
 memcpy(p->text+p->count,ptr,n);p->count+=n;p->text[p->count]=0;
 return n;
}
/* Returns 1 when TV has an 8-second prepared clip, 0 on no pending clip. */
static int take_pending(char token[49]){
 struct pending_response p={{0},0};
 CURL *c=curl_easy_init();if(!c)return 0;
 curl_easy_setopt(c,CURLOPT_URL,LAB_PENDING);
 curl_easy_setopt(c,CURLOPT_WRITEFUNCTION,pending_sink);
 curl_easy_setopt(c,CURLOPT_WRITEDATA,&p);
 curl_easy_setopt(c,CURLOPT_TIMEOUT,12L);
 curl_easy_setopt(c,CURLOPT_CONNECTTIMEOUT,7L);
 curl_easy_setopt(c,CURLOPT_FOLLOWLOCATION,0L);
 curl_easy_setopt(c,CURLOPT_SSL_VERIFYPEER,1L);
 curl_easy_setopt(c,CURLOPT_SSL_VERIFYHOST,2L);
 curl_easy_setopt(c,CURLOPT_NOSIGNAL,1L);
 curl_easy_setopt(c,CURLOPT_PROTOCOLS,(long)CURLPROTO_HTTPS);
 CURLcode result=curl_easy_perform(c);long http=0;
 curl_easy_getinfo(c,CURLINFO_RESPONSE_CODE,&http);curl_easy_cleanup(c);
 if(result!=CURLE_OK||http!=200){fprintf(stderr,"[lab] pending request code=%d http=%ld\n",(int)result,http);return 0;}
 const char *pfx="\"token\":\"";const char *where=strstr(p.text,pfx);
 if(!where)return 0;
 where+=strlen(pfx);
 if(strlen(where)<49||where[48]!='\"')return 0;
 for(int i=0;i<48;i++)if(!ishex(where[i]))return 0;
 memcpy(token,where,48);token[48]=0;return 1;
}
/* Return 0 = offline test; 1 = remote prepared; -1 = attempted but failed. */
int lab_fetch_launch(int argc,char **argv,char *video,size_t vlen,char *audio,size_t alen){
 const char *params=app_launch_params(argc,argv);
 char vurl[256]={0},aurl[256]={0},vtok[49],atok[49];
 int havev=params?app_launch_param_string(params,"videoUrl",vurl,sizeof(vurl)):0;
 int havea=params?app_launch_param_string(params,"audioUrl",aurl,sizeof(aurl)):0;
 if(!havev&&!havea){
  if(curl_global_init(CURL_GLOBAL_DEFAULT)!=0)return 0;
  char token[49];
  int queued=take_pending(token);
  curl_global_cleanup();
  if(!queued){fprintf(stderr,"[lab] no queued film clip; fallback to offline test\n");return 0;}
  snprintf(vurl,sizeof(vurl),"%s%s%s",LAB_VIDEO_PREFIX,token,LAB_VIDEO_SUFFIX);
  snprintf(aurl,sizeof(aurl),"%s%s%s",LAB_VIDEO_PREFIX,token,LAB_AUDIO_SUFFIX);
  havev=havea=1;
 }
 if(!havev||!havea||
    !token_from_url(vurl,LAB_VIDEO_SUFFIX,vtok)||
    !token_from_url(aurl,LAB_AUDIO_SUFFIX,atok)||
    strcmp(vtok,atok)!=0){fprintf(stderr,"[lab] invalid paired clip URLs\n");return -1;}
 if(vlen<80||alen<80)return -1;
 snprintf(video,vlen,"/tmp/xiptv-%ld-video.h264",(long)getpid());
 snprintf(audio,alen,"/tmp/xiptv-%ld-audio.aac",(long)getpid());
 if(curl_global_init(CURL_GLOBAL_DEFAULT)!=0)return -1;
 int ok=fetch(vurl,video)&&fetch(aurl,audio)&&magic(video,1)&&magic(audio,0);
 curl_global_cleanup();
 if(!ok){unlink(video);unlink(audio);fprintf(stderr,"[lab] real provider clip not usable\n");return -1;}
 fprintf(stderr,"[lab] downloaded provider-derived H264+AAC pair\n");
 return 1;
}
void lab_fetch_cleanup(const char *video,const char *audio){if(video&&*video)unlink(video);if(audio&&*audio)unlink(audio);}
