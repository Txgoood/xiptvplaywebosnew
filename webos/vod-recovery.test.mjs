import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const script=fs.readFileSync(new URL('./tv-vod-recovery.js',import.meta.url),'utf8');
function fixture(){
 const handlers={},timers=[],events=[];
 const video={
  src:'',currentTime:0,error:null,
  pause(){},load(){},play(){return undefined;},
  removeAttribute(field){if(field==='src')this.src='';},
  addEventListener(name,fn){(handlers[name]||(handlers[name]=[])).push(fn);},
  removeEventListener(name,fn){handlers[name]=(handlers[name]||[]).filter(x=>x!==fn);},
  emit(name){for(const fn of (handlers[name]||[]).slice())fn();}
 };
 const win={};
 let next=0;
 const ctx={window:win,document:{getElementById:()=>video},
  setTimeout(fn){let t={id:++next,fn,cancelled:false};timers.push(t);return t.id;},
  clearTimeout(id){for(const t of timers)if(t.id===id)t.cancelled=true;}};
 vm.runInNewContext(script,ctx);
 return {video,win,events,timers,handlers,
  begin(kind='movie',transport='direct',extension='mkv'){
   const info={transport,extension};
   const started=win.XIPTVVODRecovery.start({kind,extension,initialTransport:transport,directUrl:'http://provider.example/movie/USER/PASS/9.'+extension,proxyPrefix:'https://backend.example/api/iptv/proxy',playbackInfo:info,onStatus:m=>events.push(m)});
   return {started,info};
  }};
}
test('live television never activates VOD recovery',()=>{
 const f=fixture();assert.equal(f.begin('live').started,false);assert.equal((f.handlers.error||[]).length,0);
});
test('a failed MKV direct source gets only one proxy retry without logging credentials',()=>{
 const f=fixture(),info=f.begin('movie').info;
 f.video.error={code:4};f.video.emit('error');
 assert.match(f.video.src,/^https:\/\/backend\.example\/api\/iptv\/proxy\?url=/);
 assert.equal(info.transport,'proxy-auto');
 f.video.error={code:4};f.video.emit('error');
 assert.equal(info.terminal,true);
 assert.equal((f.handlers.error||[]).length,0);
 assert.equal(f.events.length,2);
 assert.equal(f.events.join(' ').includes('USER'),false);
 assert.equal(f.events.join(' ').includes('PASS'),false);
});
test('actual advancing decoded playback stops recovery and prevents runtime switches',()=>{
 const f=fixture(),info=f.begin('series','direct','mp4').info;
 f.video.currentTime=15;f.video.emit('timeupdate');
 f.video.currentTime=15.6;f.video.emit('timeupdate');
 f.video.error={code:4};f.video.emit('error');
 assert.equal(info.retrying,false);
 assert.equal(f.video.src,'');
 assert.equal(f.events.length,0);
});
test('manual proxy selection does not create any retry loop',()=>{
 const f=fixture(),info=f.begin('movie','proxy').info;
 f.video.error={code:4};f.video.emit('error');
 assert.equal(info.terminal,true);assert.equal(f.video.src,'');assert.equal(f.events.length,1);
});
test('changing source cancels old watchdog; empty VOD context is ignored',()=>{
 const f=fixture();f.begin();
 const previous=f.timers[f.timers.length-1];f.win.XIPTVVODRecovery.stop();
 assert.equal(previous.cancelled,true);
 assert.equal((f.handlers.error||[]).length,0);
 assert.equal(f.win.XIPTVVODRecovery.start({kind:'series'}),false);
});
