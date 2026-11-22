/**
 * XIPTV Play Native Player Lab — isolated short-clip HLS-to-elementary-stream bridge.
 * Launch separately from LG production media service. No Android/TV app changes.
 * Uses existing authenticated Xtream /tracks + FFmpeg clip preparation internally.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_PORT=Number(process.env.PORT||10000);
const BRIDGE_PORT=31919;
const PUBLIC_ORIGIN=process.env.NATIVE_LAB_PUBLIC_ORIGIN||'https://xiptvplay-native-lab.onrender.com';
const FF_MPEG=path.join(path.dirname(fileURLToPath(import.meta.url)),'../lg-media-service/node_modules/@ffmpeg-installer/linux-x64/ffmpeg');
const RELAY_TTL_MS=3*60*1000,MAX_BYTES=8*1024*1024,MAX_POST=1600;
const media=new Map(),usage=new Map();
let active=false,internalReady=false;
if(!/^https:\/\/[a-z0-9.-]+\.onrender\.com$/.test(PUBLIC_ORIGIN))throw Error('Invalid public origin');
process.env.PORT=String(BRIDGE_PORT);
await import('../lg-media-service/server.mjs');
process.env.PORT=String(WEB_PORT);
async function waitBackend(){
 for(let i=0;i<50;i++){
  try{const r=await fetch('http://127.0.0.1:'+BRIDGE_PORT+'/health');if(r.ok){internalReady=true;return;}}
  catch(e){}
  await new Promise(r=>setTimeout(r,300));
 }
 throw Error('LG media backend not ready');
}
waitBackend().catch(e=>console.error('[lab] internal boot failed: '+e.message));
function fail(res,status,message){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({success:false,error:message}));}
function respond(res,data){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function safeToken(s){return /^[a-f0-9]{48}$/.test(s);}
function rate(ip){
 const key=String(ip||'unknown'),now=Date.now(),prev=usage.get(key);
 if(prev&&now-prev.ts<60000&&prev.count>=2)return false;
 if(!prev||now-prev.ts>=60000)usage.set(key,{ts:now,count:1});else prev.count++;
 return true;
}
async function body(req){
 let n=0,parts=[];
 for await(const chunk of req){n+=chunk.length;if(n>MAX_POST)throw Error('Request too large');parts.push(chunk);}
 return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
async function innerJson(route,params){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),85000);
 try{
  const r=await fetch('http://127.0.0.1:'+BRIDGE_PORT+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params),signal:controller.signal});
  const result=await r.json();if(!r.ok||!result.success)throw Error(String(result.error||'Media analysis failed'));
  return result;
 }finally{clearTimeout(timer);}
}
async function innerBytes(route){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
 try{
  const r=await fetch('http://127.0.0.1:'+BRIDGE_PORT+route,{signal:controller.signal});
  const size=Number(r.headers.get('content-length')||0);
  if(!r.ok||size>MAX_BYTES)throw Error('Internal MP4 unavailable');
  const bytes=Buffer.from(await r.arrayBuffer());
  if(bytes.length<2048||bytes.length>MAX_BYTES)throw Error('Invalid MP4 clip size');
  return bytes;
 }finally{clearTimeout(timer);}
}
async function demux(bytes,kind){
 const args=kind==='video'?['-nostdin','-v','error','-i','pipe:0','-map','0:v:0','-c:v','copy','-bsf:v','h264_mp4toannexb','-f','h264','pipe:1']:
  ['-nostdin','-v','error','-i','pipe:0','-map','0:a:0','-c:a','copy','-f','adts','pipe:1'];
 return new Promise((resolve,reject)=>{
  const proc=spawn(FF_MPEG,args,{stdio:['pipe','pipe','pipe']});
  let len=0,out=[],err='',done=false;
  const timer=setTimeout(()=>proc.kill('SIGKILL'),15000);
  proc.stdout.on('data',chunk=>{len+=chunk.length;if(len>MAX_BYTES)proc.kill('SIGKILL');else out.push(chunk);});
  proc.stderr.on('data',chunk=>{if(err.length<500)err+=String(chunk).slice(0,500);});
  proc.on('error',()=>{clearTimeout(timer);if(!done){done=true;reject(Error('FFmpeg executable missing'));}});
  proc.on('close',(code,signal)=>{
   clearTimeout(timer);
   if(done)return;done=true;
   if(code!==0||signal||len<512){reject(Error('Demux failed for '+kind));return;}
   resolve(Buffer.concat(out));
  });
  proc.stdin.on('error',()=>{});
  proc.stdin.end(bytes);
 });
}
const server=http.createServer(async(req,res)=>{
 try{
  const origin=req.headers.origin;
  // Native webOS packaged apps use file:// with a null origin.
  if(origin==='null'){res.setHeader('Access-Control-Allow-Origin','null');res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});res.end();return;}
  const pathname=new URL(req.url||'/', 'http://localhost').pathname;
  if(req.method==='GET'&&pathname==='/health'){respond(res,{success:true,service:'native-lab-bridge',ready:internalReady,clipSeconds:8});return;}
  if(req.method==='POST'&&pathname==='/prepare'){
   if(origin&&origin!=='null'){fail(res,403,'Web origin not allowed');return;}
   if(!internalReady){fail(res,503,'Media service is starting');return;}
   if(active){fail(res,429,'Conversion already in progress');return;}
   if(!rate(req.socket.remoteAddress)){fail(res,429,'Try again after one minute');return;}
   const raw=await body(req);
   const data={serverUrl:raw.serverUrl,username:raw.username,password:raw.password,kind:raw.kind,id:raw.id,extension:raw.extension};
   if(!['movie','series'].includes(data.kind)||!/^\d{1,12}$/.test(String(data.id||''))){fail(res,400,'Invalid content selection');return;}
   if(!['m3u8','mp4','mkv','ts'].includes(String(data.extension||''))){fail(res,400,'Invalid extension');return;}
   active=true;
   try{
    const scan=await innerJson('/tracks',data);
    if(!safeToken(scan.token))throw Error('Unexpected session id');
    const clip=await innerJson('/compat-mp4/prepare/'+scan.token,{});
    if(!/^\/compat-mp4\/file\/[a-f0-9]{48}\.mp4$/.test(clip.path))throw Error('Invalid clip path');
    const bytes=await innerBytes(clip.path);
    const [video,audio]=await Promise.all([demux(bytes,'video'),demux(bytes,'audio')]);
    const ticket=randomBytes(24).toString('hex');
    media.set(ticket,{video,audio,expires:Date.now()+RELAY_TTL_MS});
    while(media.size>5)media.delete(media.keys().next().value);
    respond(res,{success:true,seconds:8,format:'h264-annexb+adts-aac',videoBytes:video.length,audioBytes:audio.length,
      videoUrl:PUBLIC_ORIGIN+'/media/'+ticket+'/video.h264',audioUrl:PUBLIC_ORIGIN+'/media/'+ticket+'/audio.aac',
      expiresIn:180});
   }finally{active=false;}
   return;
  }
  const matched=pathname.match(/^\/media\/([a-f0-9]{48})\/(video\.h264|audio\.aac)$/);
  if(req.method==='GET'&&matched){
   const [,ticket,name]=matched,clip=media.get(ticket);
   if(!clip||clip.expires<Date.now()){fail(res,404,'Clip expired');return;}
   const bytes=name==='video.h264'?clip.video:clip.audio;
   res.writeHead(200,{'Content-Type':name==='video.h264'?'video/h264':'audio/aac','Content-Length':bytes.length,
     'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
   res.end(bytes);return;
  }
  fail(res,404,'Not found');
 }catch(e){console.warn('[lab] request rejected: '+String(e.message||'error').replace(/https?:\/\/\S+/g,'[url]').slice(0,80));fail(res,502,'Kaynak hazırlanamadı: '+String(e.message||'error').replace(/https?:\/\/\S+/g,'[url]').slice(0,100));}
});
if(process.env.NODE_ENV!=='test')server.listen(WEB_PORT,'0.0.0.0',()=>console.log('[lab] bridge listening on '+WEB_PORT));
export {server,safeToken};
