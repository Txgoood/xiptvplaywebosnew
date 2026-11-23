/*
 * Optional network bridge for LG webOS 2.0.
 * Built as a shared plugin and loaded only after the NDL menu is visible.
 * On legacy firmware missing libcurl.so.4 (or its TLS dependencies),
 * the core application can still start and show a useful error.
 */
#include <curl/curl.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
struct writer { char *buf; size_t used, limit; };
static size_t capture(char *data,size_t size,size_t count,void *arg){
 struct writer *out=arg;
 if(size&&count>SIZE_MAX/size)return 0;
 size_t n=size*count;
 if(n>out->limit-out->used)return 0;
 memcpy(out->buf+out->used,data,n);
 out->used+=n;out->buf[out->used]=0;
 return n;
}
/* 1=HTTP 200, -curl error, -1000-HTTP status or -9999 setup failure. */
int xiptv_net_http(const char *url,const char *post,char *out,size_t cap,int timeout){
 if(!url||!out||cap<2)return -9999;
 static int initialized=0;
 if(!initialized){if(curl_global_init(CURL_GLOBAL_DEFAULT)!=CURLE_OK)return -9999;initialized=1;}
 CURL *curl=curl_easy_init();
 if(!curl)return -9999;
 struct writer dst={out,0,cap-1};out[0]=0;
 curl_easy_setopt(curl,CURLOPT_URL,url);
 curl_easy_setopt(curl,CURLOPT_WRITEFUNCTION,capture);
 curl_easy_setopt(curl,CURLOPT_WRITEDATA,&dst);
 curl_easy_setopt(curl,CURLOPT_TIMEOUT,(long)timeout);
 curl_easy_setopt(curl,CURLOPT_CONNECTTIMEOUT,12L);
 curl_easy_setopt(curl,CURLOPT_NOSIGNAL,1L);
 curl_easy_setopt(curl,CURLOPT_FOLLOWLOCATION,0L);
 curl_easy_setopt(curl,CURLOPT_SSL_VERIFYPEER,1L);
 curl_easy_setopt(curl,CURLOPT_SSL_VERIFYHOST,2L);
 curl_easy_setopt(curl,CURLOPT_PROTOCOLS,(long)CURLPROTO_HTTPS);
 struct curl_slist *headers=NULL;
 if(post){
  headers=curl_slist_append(headers,"Content-Type: application/json");
  curl_easy_setopt(curl,CURLOPT_HTTPHEADER,headers);
  curl_easy_setopt(curl,CURLOPT_POSTFIELDS,post);
 }
 CURLcode result=curl_easy_perform(curl);
 long http=0;curl_easy_getinfo(curl,CURLINFO_RESPONSE_CODE,&http);
 curl_slist_free_all(headers);curl_easy_cleanup(curl);
 if(result!=CURLE_OK)return -(int)result;
 return http==200?1:-(int)(1000+http);
}
