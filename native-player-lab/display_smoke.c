/*
 * LG webOS 2 standalone SDL renderer check.
 * Uses the exact SDL init/window/accelerated renderer from the
 * v0.2.1 sample that displayed video and audio on the user's TV.
 * No network calls, hardware decoder or account access.
 */
#include <SDL.h>
#include <stdbool.h>
#include <stdio.h>
#include "sdl_shell.h"

static void bar(SDL_Renderer *renderer,int x,int y,int w,int h,
                Uint8 red,Uint8 green,Uint8 blue) {
 SDL_Rect rc={x,y,w,h};
 SDL_SetRenderDrawColor(renderer,red,green,blue,255);
 SDL_RenderFillRect(renderer,&rc);
}
int main(int argc,char **argv) {
 (void)argc;(void)argv;
 FILE *log=fopen("/tmp/xiptv-native-smoke.log","w");
 if(log){fputs("ENTERED\n",log);fflush(log);}
 if(!sdl_shell_preinit()){
  if(log){fputs("SDL_PREINIT_FAIL\n",log);fclose(log);}
  return 11;
 }
 if(log){fputs("SDL_PREINIT_OK\n",log);fflush(log);}
 sdl_shell sh;
 if(!sdl_shell_open_window(&sh,"XIPTV SDL Screen Test")){
  if(log){fprintf(log,"SDL_WINDOW_FAIL: %s\n",SDL_GetError());fclose(log);}
  return 12;
 }
 if(log){fputs("SDL_WINDOW_OK\n",log);fflush(log);}
 Uint32 begin=SDL_GetTicks();
 bool done=false,toggled=false,first=true;
 while(!done){
  SDL_Event event;
  while(SDL_PollEvent(&event)){
   if(event.type==SDL_QUIT)done=true;
   if(event.type==SDL_KEYDOWN){
    SDL_Keycode key=event.key.keysym.sym;
    if(key==SDLK_ESCAPE||key==SDLK_BACKSPACE)done=true;
    else if(key==SDLK_RETURN||key==SDLK_KP_ENTER)toggled=!toggled;
   }
  }
  int w=sh.display_width,h=sh.display_height;
  SDL_SetRenderDrawBlendMode(sh.renderer,SDL_BLENDMODE_NONE);
  SDL_SetRenderDrawColor(sh.renderer,18,31,53,255);
  SDL_RenderClear(sh.renderer);
  bar(sh.renderer,w/16,h/7,w*7/8,h/8,24,158,232);
  bar(sh.renderer,w/16,h*3/7,w*7/8,h/8,toggled?22:232,toggled?191:65,61);
  bar(sh.renderer,w/16,h*5/7,w*7/8,h/8,42,210,110);
  int moving=(int)((SDL_GetTicks()-begin)/20)%(w*3/4);
  bar(sh.renderer,w/8+moving,h*2/3,35,35,255,245,255);
  SDL_RenderPresent(sh.renderer);
  if(first){first=false;if(log){fputs("FIRST_FRAME_PRESENTED_CALL\n",log);fflush(log);}}
  SDL_Delay(33);
 }
 if(log){fputs("EXIT_NORMAL\n",log);fclose(log);}
 sdl_shell_close(&sh);
 return 0;
}
