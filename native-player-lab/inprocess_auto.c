/* XIPTV Native Player Lab v0.3.0: real HLS clip + in-process fallback. */
#include <limits.h>
#include <signal.h>
#include <stdio.h>
extern int xiptv_ndl_main(int argc, char *argv[]);
extern int xiptv_acb_main(int argc, char *argv[]);
extern volatile sig_atomic_t xiptv_ndl_first_frame;
extern volatile sig_atomic_t xiptv_smp_first_frame;
extern int lab_fetch_launch(int argc,char **argv,char *video,unsigned long vlen,char *audio,unsigned long alen);
extern void lab_fetch_cleanup(const char *video,const char *audio);
int main(int argc,char *argv[]){
 char video[PATH_MAX]={0},audio[PATH_MAX]={0};
 int remote=lab_fetch_launch(argc,argv,video,sizeof(video),audio,sizeof(audio));
 if(remote<0){fprintf(stderr,"[lab-auto] real provider clip preparation failed\n");return 12;}
 char *params[]={argv[0],"--video",video,"--audio",audio,"--fps","20","--size","640x360",NULL};
 int nargs=remote?9:argc;
 char **args=remote?params:argv;
 fprintf(stderr,"[lab-auto] v0.3.0 start NDL (%s)\n",remote?"provider-derived":"offline sample");
 xiptv_ndl_first_frame=0;
 int status=xiptv_ndl_main(nargs,args);
 if(xiptv_ndl_first_frame){
   fprintf(stderr,"[lab-auto] NDL presented first frame\n");
   if(remote)lab_fetch_cleanup(video,audio);
   return status;
 }
 fprintf(stderr,"[lab-auto] NDL no frame status=%d. Trying ACB\n",status);
 xiptv_smp_first_frame=0;
 status=xiptv_acb_main(nargs,args);
 if(xiptv_smp_first_frame)fprintf(stderr,"[lab-auto] ACB presented first frame\n");
 else fprintf(stderr,"[lab-auto] ACB also did not present first frame\n");
 if(remote)lab_fetch_cleanup(video,audio);
 return xiptv_smp_first_frame?status:(status?status:1);
}
