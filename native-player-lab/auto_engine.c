/*
 * XIPTV Native Player Lab v0.2.0 — sequential native engine fallback.
 * Both engines are offline H264/AAC sample decoders. No IPTV URLs or credentials.
 * Never run both hardware pipelines concurrently: one child must exit first.
 */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <limits.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t stopping=0,child_pid=0;
static void request_stop(int sig){(void)sig;stopping=1;if(child_pid>0)kill(child_pid,SIGTERM);}
static double seconds_since(const struct timespec *begin){
 struct timespec now;clock_gettime(CLOCK_MONOTONIC,&now);
 return (double)(now.tv_sec-begin->tv_sec)+(double)(now.tv_nsec-begin->tv_nsec)/1e9;
}
static int marker_present(const char *p){struct stat st;return stat(p,&st)==0&&S_ISREG(st.st_mode)&&st.st_size>=2;}
static void reap_child(pid_t pid){
 int status=0;int ticks=0;
 kill(pid,SIGTERM);
 while(ticks++<20){pid_t ret=waitpid(pid,&status,WNOHANG);if(ret==pid||ret<0)return;struct timespec t={0,100000000};nanosleep(&t,NULL);}
 kill(pid,SIGKILL);while(waitpid(pid,&status,0)<0&&errno==EINTR){}
}
static int run_engine(const char *exe,const char *marker,int timeout){
 struct timespec started;clock_gettime(CLOCK_MONOTONIC,&started);
 unlink(marker);
 pid_t pid=fork();
 if(pid<0){fprintf(stderr,"[lab] fork failed for %s\n",exe);return 1;}
 if(pid==0){
  setenv("XIPTV_LAB_READY_MARKER",marker,1);
  char *const args[]={ (char*)exe,NULL };
  execv(exe,args);
  fprintf(stderr,"[lab] exec failed for %s: %s\n",exe,strerror(errno));_exit(127);
 }
 child_pid=pid;
 int ready=0,status=0;
 for(;;){
  if(marker_present(marker)){ready=1;fprintf(stderr,"[lab] first frame confirmed, engine=%s\n",exe);break;}
  pid_t done=waitpid(pid,&status,WNOHANG);
  if(done==pid){child_pid=0;unlink(marker);fprintf(stderr,"[lab] exited before first frame, engine=%s status=%d\n",exe,status);return 1;}
  if(done<0){child_pid=0;unlink(marker);return 1;}
  if(stopping||seconds_since(&started)>=timeout){fprintf(stderr,"[lab] no first frame within %ds on %s\n",timeout,exe);reap_child(pid);child_pid=0;unlink(marker);return 1;}
  struct timespec sleep_time={0,100000000};nanosleep(&sleep_time,NULL);
 }
 // Once the first frame is confirmed, let the child own playback until it exits.
 // This deliberately does not switch engines mid-film or after normal user exit.
 while(!stopping){
  pid_t done=waitpid(pid,&status,WNOHANG);
  if(done==pid){child_pid=0;break;}
  if(done<0){child_pid=0;break;}
  struct timespec sleep_time={0,100000000};nanosleep(&sleep_time,NULL);
 }
 if(stopping&&child_pid>0){reap_child(pid);child_pid=0;}
 unlink(marker);
 return ready?0:1;
}
int main(int argc,char **argv){
 (void)argc;(void)argv;
 signal(SIGTERM,request_stop);signal(SIGINT,request_stop);
 char exe[PATH_MAX],folder[PATH_MAX];
 ssize_t len=readlink("/proc/self/exe",exe,sizeof(exe)-1);
 if(len<1||len>=(ssize_t)sizeof(exe)-1){fprintf(stderr,"[lab] cannot locate executable\n");return 2;}
 exe[len]='\0';char *slash=strrchr(exe,'/');if(!slash)return 2;*slash='\0';
 snprintf(folder,sizeof(folder),"%s",exe);
 char ndl[PATH_MAX],acb[PATH_MAX],marker[PATH_MAX];
 if(snprintf(ndl,sizeof(ndl),"%s/media-ndl-esplayer",folder)>=(int)sizeof(ndl)||
    snprintf(acb,sizeof(acb),"%s/media-smp-acb-webos2",folder)>=(int)sizeof(acb))return 2;
 const char *override=getenv("XIPTV_LAB_MARKER");
 if(override&&override[0]){
  if(strlen(override)>=sizeof(marker))return 2;
  strcpy(marker,override);
 }else{
  snprintf(marker,sizeof(marker),"/tmp/xiptv-lab-ready-%ld",(long)getpid());
 }
 int timeout=12;
 const char *opt=getenv("XIPTV_LAB_TIMEOUT_SEC");
 if(opt){int n=atoi(opt);if(n>=1&&n<=30)timeout=n;}
 fprintf(stderr,"[lab] v0.2.0 NDL first, Starfish ACB if no confirmed first frame\n");
 if(run_engine(ndl,marker,timeout)==0){fprintf(stderr,"[lab] NDL confirmed\n");return 0;}
 if(stopping)return 130;
 fprintf(stderr,"[lab] NDL unavailable; starting Starfish ACB\n");
 if(run_engine(acb,marker,timeout)==0){fprintf(stderr,"[lab] ACB confirmed\n");return 0;}
 if(stopping)return 130;
 fprintf(stderr,"[lab] neither native engine showed a first frame\n");
 return 1;
}
