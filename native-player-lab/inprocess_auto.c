/* XIPTV Native Player Lab v0.2.1. No fork or exec. */
#include <signal.h>
#include <stdio.h>
extern int xiptv_ndl_main(int argc, char *argv[]);
extern int xiptv_acb_main(int argc, char *argv[]);
extern volatile sig_atomic_t xiptv_ndl_first_frame;
extern volatile sig_atomic_t xiptv_smp_first_frame;
int main(int argc,char *argv[]){
 fprintf(stderr,"[lab-auto] v0.2.1 NDL in-process\n");
 xiptv_ndl_first_frame=0;
 int status=xiptv_ndl_main(argc,argv);
 if(xiptv_ndl_first_frame){fprintf(stderr,"[lab-auto] NDL first frame observed, status=%d\n",status);return status;}
 fprintf(stderr,"[lab-auto] NDL failed to show first frame (status=%d); try ACB\n",status);
 xiptv_smp_first_frame=0;
 status=xiptv_acb_main(argc,argv);
 if(xiptv_smp_first_frame){fprintf(stderr,"[lab-auto] ACB first frame observed, status=%d\n",status);return status;}
 fprintf(stderr,"[lab-auto] No frame on either engine, status=%d\n",status);
 return status?status:1;
}
