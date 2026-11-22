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
const MAX_CATALOG_BYTES=40*1024*1024;
const media=new Map(),usage=new Map(),pending=new Map(),diagnostics=new Map(),pairs=new Map();
const PAIR_TTL=10*60*1000;
const DIAG_TTL=10*60*1000;
const PENDING_TTL_MS=90*1000;
let active=false,internalReady=false;
if(!/^https:\/\/[a-z0-9.-]+\.onrender\.com$/.test(PUBLIC_ORIGIN))throw Error('Invalid public origin');
process.env.PORT=String(BRIDGE_PORT);
const {validateHost}=await import('../lg-media-service/server.mjs');
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
function clientIp(req){
 const forwarded=String(req.headers['x-forwarded-for']||'');
 const first=forwarded.split(',')[0].trim();
 return first&&first.length<=64?first:String(req.socket.remoteAddress||'');
}
export function filterMovies(items,query){
 if(!Array.isArray(items))return [];
 const needle=String(query||'').trim().toLocaleLowerCase('tr');
 if(needle.length<2||needle.length>80)return [];
 const found=[];
 for(const item of items){
  if(found.length>=30)break;
  if(!item||!/^[0-9]{1,12}$/.test(String(item.stream_id||'')))continue;
  const title=String(item.name||'').slice(0,160);
  if(!title.toLocaleLowerCase('tr').includes(needle))continue;
  const extension=String(item.container_extension||'m3u8').toLowerCase();
  found.push({id:String(item.stream_id),title,extension:['mp4','mkv','ts','m3u8'].includes(extension)?extension:'m3u8'});
 }
 return found;
}
async function fetchCatalog(raw){
 const origin=await validateHost(String(raw.serverUrl||''),{username:raw.username,password:raw.password});
 const endpoint=new URL('/player_api.php',origin);
 endpoint.searchParams.set('username',String(raw.username||''));
 endpoint.searchParams.set('password',String(raw.password||''));
 endpoint.searchParams.set('action','get_vod_streams');
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),18000);
 try{
  const response=await fetch(endpoint,{redirect:'manual',signal:controller.signal,headers:{'Accept':'application/json','User-Agent':'XIPTV-NativeLab/0.3'}});
  if(!response.ok||response.status>=300)throw Error('Katalog hizmeti HTTP '+response.status);
  const declared=Number(response.headers.get('content-length')||0);
  if(declared>MAX_CATALOG_BYTES)throw Error('Katalog boyutu test sınırını aşıyor');
  const chunks=[];let count=0;
  for await(const chunk of response.body){
   count+=chunk.length;
   if(count>MAX_CATALOG_BYTES)throw Error('Katalog boyutu test sınırını aşıyor');
   chunks.push(chunk);
  }
  const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!Array.isArray(parsed))throw Error('IPTV sağlayıcısı film kataloğu döndürmedi');
  return parsed;
 }finally{clearTimeout(timeout);}
}
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
  // Isolated test API has no cookies. webOS 2 uses app-specific Origin headers.
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});res.end();return;}
  const pathname=new URL(req.url||'/', 'http://localhost').pathname;
  if(req.method==='GET'&&pathname==='/health'){respond(res,{success:true,service:'native-lab-bridge',ready:internalReady,clipSeconds:8});return;}
  if(req.method==='GET'&&pathname==='/pending'){
   const ip=clientIp(req),task=pending.get(ip);
   if(!task||task.expires<Date.now()||!media.has(task.ticket)){pending.delete(ip);fail(res,404,'No recent clip for this network');return;}
   pending.delete(ip);
   console.log('[lab] pending clip collected by native client');
   respond(res,{success:true,token:task.ticket});return;
  }
  if(req.method==='POST'&&pathname==='/diag'){
   const input=await body(req);
   const allowed=['start','pending_ok','pending_none','pending_network','fetch_video_ok','fetch_video_fail','fetch_audio_ok','fetch_audio_fail','clip_invalid','native_ready','ndl_start','ndl_first_frame','ndl_failed','acb_start','acb_first_frame','acb_failed','remote_abort','offline_fallback'];
   const phase=String(input.phase||'');
   const code=Number(input.code||0);
   if(!allowed.includes(phase)||!Number.isInteger(code)||code<0||code>1000){fail(res,400,'Invalid native status');return;}
   const ip=clientIp(req);
   diagnostics.set(ip,{phase,code,updatedAt:Date.now()});
   while(diagnostics.size>200)diagnostics.delete(diagnostics.keys().next().value);
   console.log('[lab-native] phase='+phase+' code='+code);
   respond(res,{success:true});
   return;
  }
  if(req.method==='GET'&&pathname==='/diag'){
   const row=diagnostics.get(clientIp(req));
   if(!row||Date.now()-row.updatedAt>DIAG_TTL){respond(res,{success:true,found:false});return;}
   respond(res,{success:true,found:true,phase:row.phase,code:row.code});
   return;
  }
  if(req.method==='GET'&&pathname==='/pair'){
   const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XIPTV Native Baglanti</title>
   <style>body{font:19px Arial;background:#0b1c2d;color:white;max-width:560px;margin:30px auto;padding:15px}input,button{display:block;box-sizing:border-box;width:100%;padding:15px;font-size:20px;margin:10px 0;border-radius:7px}button{background:#007a92;color:white}small{color:#bdd}</style>
   <h2>XIPTV Native Player - TV Hesap Bagla</h2><small>Bu sayfa sadece test icindir. Kodu TV ekranindan al. Baglanti bilgileri bir kez native uygulamaya aktarilir.</small>
   <input id="code" placeholder="TV'deki 8 karakterlik kod" maxlength="8" autocomplete="off">
   <input id="m3u" placeholder="http://sunucu:8080/get.php?username=...&password=..." autocomplete="off">
   <button id="go">TV'ye Hesabi Aktar</button><p id="status"></p><script>
   document.getElementById('go').onclick=function(){
    var val=document.getElementById('m3u').value.trim(),c=document.getElementById('code').value.trim().toUpperCase();
    var match=/^(https?):\\/\\/([^\\/?#]+)\\/get\\.php\\?([^#]+)$/i.exec(val);
    if(!match){document.getElementById('status').textContent='Gecerli get.php M3U baglantisi girin';return;}
    var params=new URLSearchParams(match[3]);
    var data={code:c,serverUrl:match[1]+'://'+match[2],username:params.get('username'),password:params.get('password')};
    if(!data.username||!data.password){document.getElementById('status').textContent='Linkte username/password bulunamadi';return;}
    fetch('/pair/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json()}).then(function(o){document.getElementById('status').textContent=o.success?'Hesap TV uygulamasina aktarilabilir. TV ekraninda BAGLANTIYI KONTROL ET sec.':(o.error||'Baglanti hatasi');document.getElementById('m3u').value='';}).catch(function(){document.getElementById('status').textContent='Sunucuya baglanilamadi';});
   };</script>`;
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self' 'unsafe-inline'; connect-src 'self'"});res.end(html);return;
  }
  if(req.method==='GET'&&pathname==='/pair/start'){
   if(!rate('pair:'+clientIp(req))){fail(res,429,'Pairing too frequent');return;}
   const token=randomBytes(24).toString('hex');
   const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
   const bytes=randomBytes(8);
   const code=Array.from(bytes,x=>chars[x%chars.length]).join('');
   pairs.set(token,{code,expires:Date.now()+PAIR_TTL,used:false,account:null});
   while(pairs.size>60)pairs.delete(pairs.keys().next().value);
   respond(res,{success:true,token,code,url:PUBLIC_ORIGIN+'/pair',expiresIn:600});return;
  }
  if(req.method==='POST'&&pathname==='/pair/claim'){
   if(!rate('claim:'+clientIp(req))){fail(res,429,'Too many attempts');return;}
   const raw=await body(req),code=String(raw.code||'').toUpperCase();
   if(!/^[A-Z2-9]{8}$/.test(code)){fail(res,400,'Invalid pairing code');return;}
   let found=null;
   for(const [token,pair] of pairs){if(pair.code===code&&pair.expires>Date.now()&&!pair.used){found=pair;break;}}
   if(!found){fail(res,404,'Code expired or unavailable');return;}
   const serverUrl=String(raw.serverUrl||''),username=String(raw.username||''),password=String(raw.password||'');
   if(username.length>160||password.length>160||!username||!password){fail(res,400,'Invalid account');return;}
   await validateHost(serverUrl,{username,password});
   found.account={serverUrl,username,password};
   found.used=true;
   respond(res,{success:true});return;
  }
  const candidate=pathname.startsWith('/pair/status/')?pathname.slice('/pair/status/'.length):'';
  const pairMatch=candidate.length===48 && candidate.split('').every(ch=>'0123456789abcdef'.includes(ch))?[pathname,candidate]:null;
  if(req.method==='GET'&&pairMatch){
   const key=pairMatch[1],found=pairs.get(key);
   if(!found||found.expires<Date.now()){pairs.delete(key);fail(res,404,'Pair expired');return;}
   if(!found.account){respond(res,{success:true,ready:false});return;}
   pairs.delete(key);
   respond(res,{success:true,ready:true,account:found.account});return;
  }
  if(req.method==='POST'&&pathname==='/search'){
   if(!internalReady){fail(res,503,'Medya hizmeti başlatılıyor');return;}
   if(!rate('search:'+req.socket.remoteAddress)){fail(res,429,'Bir dakika sonra tekrar arayın');return;}
   const raw=await body(req);
   const query=String(raw.query||'').trim();
   if(query.length<2||query.length>80){fail(res,400,'Film adı en az iki karakter olmalı');return;}
   const items=await fetchCatalog(raw);
   respond(res,{success:true,results:filterMovies(items,query),searched:items.length});
   return;
  }
  if(req.method==='POST'&&pathname==='/prepare'){
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
    pending.set(clientIp(req),{ticket,expires:Date.now()+PENDING_TTL_MS});
    diagnostics.delete(clientIp(req));
    while(pending.size>15)pending.delete(pending.keys().next().value);
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
