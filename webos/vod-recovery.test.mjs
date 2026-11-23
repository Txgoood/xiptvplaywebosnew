import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const script=fs.readFileSync(new URL('./tv-vod-recovery.js',import.meta.url),'utf8');
function fixture(){
 const handlers={},timers=[],events=[],requests=[];
 const video={
  src:'',currentTime:0,error:null,
  pause(){},load(){},play(){return undefined;},
  appendChild(source){this.child=source;source.parentNode=this;},
  removeChild(source){this.child=null;source.parentNode=null;},
  removeAttribute(field){if(field==='src')this.src='';},
  addEventListener(name,fn){(handlers[name]||(handlers[name]=[])).push(fn);},
  removeEventListener(name,fn){handlers[name]=(handlers[name]||[]).filter(x=>x!==fn);},
  emit(name){for(const fn of (handlers[name]||[]).slice())fn();}
 };
 function makeSource(tag){
  assert.equal(tag,'source');
  return {
   setAttribute(name,value){this[name]=value;},
   addEventListener(name,fn){this[name]=fn;},
   removeEventListener(name){delete this[name];}
  };
 }
 const win={};
 let next=0;
 class Request {
  constructor(){requests.push(this);}
  open(method,url){this.method=method;this.url=url;}
  setRequestHeader(){}
  send(body){this.body=body===null?null:JSON.parse(body);}
  abort(){this.aborted=true;}
  respond(status,data){this.status=status;this.responseText=JSON.stringify(data);this.onload?.();}
 }
 const ctx={window:win,document:{getElementById:()=>video,createElement:makeSource},XMLHttpRequest:Request,
  setTimeout(fn){let t={id:++next,fn,cancelled:false};timers.push(t);return t.id;},
  clearTimeout(id){for(const t of timers)if(t.id===id)t.cancelled=true;}};
 vm.runInNewContext(script,ctx);
 return {video,win,events,timers,handlers,requests,
  begin(kind='movie',transport='direct',extension='mkv',hls=false){
   const info={transport,extension};
   const started=win.XIPTVVODRecovery.start({kind,extension,initialTransport:transport,directUrl:'http://provider.example/'+kind+'/USER/PASS/9.'+extension,proxyPrefix:'https://backend.example/api/iptv/proxy',playbackInfo:info,onStatus:m=>events.push(m),
    hlsBase:hls?'https://media.example':'',hlsSource:hls?{kind,extension,id:9}:null});
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

test('paused playback never restarts itself via watchdog',()=>{
 const f=fixture();f.begin('movie','direct','mp4');
 f.video.paused=true;
 f.timers[f.timers.length-1].fn();
 assert.equal((f.handlers.error||[]).length,0);
 assert.equal(f.video.src,'');
});

test('failed movie HLS tries a single MP4 URL, never repeats the same HLS proxy',()=>{
 const f=fixture(),info=f.begin('movie','direct','m3u8').info;
 f.video.error={code:4};f.video.emit('error');
 assert.equal(info.transport,'native-mp4-fallback');
 assert.match(f.video.src,/\/movie\/USER\/PASS\/9\.mp4$/);
 f.video.error={code:4};f.video.emit('error');
 assert.equal(info.terminal,true);
 assert.equal(f.events.length,2);
});

test('film and series HLS recover through a scoped relay before trying a real MP4 source',()=>{
 const path='/tv-hls/'+'a'.repeat(48)+'/index.m3u8';
 for(const kind of ['movie','series']){
  const f=fixture(),info=f.begin(kind,'direct','m3u8',true).info;
  f.video.error={code:4};f.video.emit('error');
  assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].url,'https://media.example/tv-hls');
  assert.equal(f.requests[0].body.kind,kind);
  f.requests[0].respond(200,{success:true,path});
  assert.equal(f.video.src,'');
  assert.equal(f.video.child.src,'https://media.example'+path);
  const [mime,options]=f.video.child.type.split(';mediaOption=');
  assert.equal(mime,'application/vnd.apple.mpegurl');
  assert.deepEqual(JSON.parse(decodeURI(options)),{mediaTransportType:'HLS'});
  assert.equal(info.transport,'lg-hls-relay');
  f.video.child.error();
  assert.equal(f.requests[1].method,'GET');
  assert.equal(f.video.child,null);
  assert.match(f.requests[1].url,/\/status$/);
  f.requests[1].respond(200,{playlistRequests:1,playlistsServed:1,segmentRequests:0,segmentsServed:0});
  assert.match(f.video.src,/\.mp4$/);
  f.video.emit('error');
  assert.equal(info.terminal,true);
  assert.match(f.events.at(-1),/Uyumlu HLS LG 4\. Liste gönderildi, video parçası istenmedi/);
  assert.equal(f.requests.length,2);
 }
});

test('a working HLS source remains attached until switching away from the player',()=>{
 const f=fixture();f.begin('movie','direct','m3u8',true);
 f.video.error={code:4};f.video.emit('error');
 f.requests[0].respond(200,{success:true,path:'/tv-hls/'+'a'.repeat(48)+'/index.m3u8'});
 f.video.currentTime=1;f.video.emit('timeupdate');
 f.video.currentTime=2;f.video.emit('timeupdate');
 assert.equal(typeof f.video.child.error,'undefined');
 f.win.XIPTVVODRecovery.clearRelaySource();
 assert.equal(f.video.child,null);
});

test('retired HLS preparation cannot replace a new channel and 404 falls back once',()=>{
 const f=fixture();f.begin('series','direct','m3u8',true);
 f.video.error={code:4};f.video.emit('error');
 const pending=f.requests[0];
 f.win.XIPTVVODRecovery.stop();assert.equal(pending.aborted,true);
 f.video.src='https://provider.example/live.ts';
 pending.respond(200,{success:true,path:'/tv-hls/'+'a'.repeat(48)+'/index.m3u8'});
 assert.match(f.video.src,/live\.ts$/);
 f.begin('movie','direct','m3u8',true);f.video.emit('error');
 f.requests[1].respond(404,{});
 assert.match(f.video.src,/\.mp4$/);
 f.video.emit('error');
 assert.match(f.events.at(-1),/HTTP 404/);
});
