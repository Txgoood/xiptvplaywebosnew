/**
 * XIPTV Play LG-only experimental media companion.
 * Separate process: NEVER runs in the Android/standard IPTV backend.
 * Accepts approved hosts OR a verified active Xtream account on a public host.
 * New IPTV server addresses are verified automatically; no per-host manual edits.
 * Credentials live only in short-lived memory and are never returned/logged.
 */
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||3101);
const FFMPEG=process.env.LG_FFMPEG_PATH||path.join(here,'node_modules/@ffmpeg-installer/linux-x64/ffmpeg');
const FFPROBE=process.env.LG_FFPROBE_PATH||path.join(here,'node_modules/@ffprobe-installer/linux-x64/ffprobe');
const allowHosts=(process.env.LG_MEDIA_ALLOWED_HOSTS||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
const allowOrigins=(process.env.LG_MEDIA_ALLOWED_ORIGINS||'null').split(',').map(x=>x.trim()).filter(Boolean);
const MAX_BODY=8192, PROBE_TIMEOUT=22000, MAX_SESSIONS=64, SESSION_TTL=90*60*1000;
// Deliberate test-mode limits prevent accidental high-bandwidth bills on Render Free.
const STREAM_SECONDS=Math.max(15,Math.min(300,Number(process.env.LG_MEDIA_MAX_STREAM_SECONDS||120)));
const STREAM_BYTES=Math.max(5,Math.min(100,Number(process.env.LG_MEDIA_MAX_STREAM_MB||60)))*1024*1024;
const sessions=new Map(),ratelimits=new Map(),mediaTickets=new Map();
const MAX_UPSTREAM_BYTES=85*1024*1024;
let mediaProxyPort=0;
let activeProbes=0,activeStreams=0;
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
function error(res,status,message){json(res,status,{success:false,error:message});}
function safeIp(ip){
 const v=String(ip||'').replace(/^::ffff:/,'');
 if(!isIP(v))return false;
 if(v.includes(':'))return !(v==='::1'||v.startsWith('fe80:')||v.startsWith('fc')||v.startsWith('fd')||v==='::'||v.startsWith('2001:db8:'));
 const n=v.split('.').map(Number);
 return ! (n[0]===0||n[0]===10||n[0]===127||n[0]>=224||
  n[0]===169&&n[1]===254||n[0]===172&&n[1]>=16&&n[1]<=31||
  n[0]===192&&n[1]===168||n[0]===100&&n[1]>=64&&n[1]<=127||
  n[0]===192&&n[1]===0&&n[2]===0||
  n[0]===198&&n[1]>=18&&n[1]<=19);
}
/**
 * Validate public DNS, then accept either a pre-approved upstream or an Xtream
 * account that the upstream itself authenticates. A changed playlist URL does
 * not require a Render environment-variable update.
 *
 * No anonymous/unverified arbitrary media URLs are accepted. Redirects are
 * rejected during auth, and the media process is bounded separately.
 */
export function isXtreamAuthorized(data){
 const user=data&&data.user_info;
 if(!user||!(user.auth===1||user.auth==='1'))return false;
 const status=String(user.status||'').trim().toLowerCase();
 return status==='active'||status==='enabled'||status==='';
}
export async function validateHost(serverUrl, credentials, deps={}){
 let u;
 try{u=new URL(String(serverUrl||''));}catch(e){throw Error('Sunucu adresi geçersiz.');}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||(u.pathname!=='/'&&u.pathname!==''))throw Error('Sunucu adresi geçersiz.');
 const h=u.hostname.replace(/^\[|\]$/g,'').toLowerCase().replace(/\.$/,'');
 if(!h||h.length>253)throw Error('Sunucu alan adı geçersiz.');
 const resolver=deps.lookup||lookup;
 let addresses;
 try{addresses=await resolver(h,{all:true,verbatim:true});}
 catch(e){throw Error('Yayın sunucusunun adresi çözümlenemedi.');}
 if(!addresses.length||addresses.some(a=>!safeIp(a.address)))throw Error('Yayın sunucusu yerel veya özel ağa yönlendiriliyor.');
 // Existing approved providers remain backwards-compatible.
 if(allowHosts.includes(h))return u.origin;
 const username=String(credentials&&credentials.username||'');
 const password=String(credentials&&credentials.password||'');
 if(!username||!password||username.length>160||password.length>160)throw Error('Otomatik sunucu doğrulaması için Xtream oturumu gerekli.');
 const api=new URL('/player_api.php',u.origin);
 api.searchParams.set('username',username);
 api.searchParams.set('password',password);
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),9000);
 try{
  const fetcher=deps.fetch||fetch;
  const response=await fetcher(api.toString(),{method:'GET',redirect:'manual',signal:controller.signal,headers:{'User-Agent':'VLC/3.0.18','Accept':'application/json'}});
  // Never chase an arbitrary destination returned by the provider.
  if(!response.ok||response.status>=300)throw Error('Xtream hesabı bu sunucuda doğrulanamadı.');
  const max=128*1024,declared=Number(response.headers&&response.headers.get('content-length')||0);
  if(declared>max)throw Error('Xtream doğrulama yanıtı sınırı aşıyor.');
  const raw=await response.text();
  if(raw.length>max)throw Error('Xtream doğrulama yanıtı sınırı aşıyor.');
  let data;try{data=JSON.parse(raw);}catch(e){throw Error('Bu adres Xtream doğrulama yanıtı vermedi.');}
  if(!isXtreamAuthorized(data))throw Error('Xtream hesabı aktif değil veya sunucu doğrulamayı reddetti.');
  return u.origin;
 }catch(e){
  if(e.name==='AbortError')throw Error('Yayın sunucusu doğrulaması zaman aşımına uğradı.');
  if(e.message&&(/Xtream|yanıtı sınırı|Bu adres/).test(e.message))throw e;
  throw Error('Yayın sunucusunda hesap doğrulaması yapılamadı.');
 }finally{clearTimeout(timer);}
}
export function sourcePath(data,origin){
 if(!['movie','series'].includes(data.kind))throw Error('Alternatif motor yalnızca Film/Dizi için kullanılabilir.');
 const id=String(data.id||'');
 if(!/^[0-9]{1,12}$/.test(id))throw Error('İçerik kimliği geçersiz.');
 const user=String(data.username||''),pass=String(data.password||'');
 if(!user||!pass||user.length>160||pass.length>160||/[\/\r\n]/.test(user+pass))throw Error('Xtream kimlik bilgisi geçersiz.');
 const ext=String(data.extension||'mp4').toLowerCase();
 if(!['mp4','mkv','avi','ts','mov','m4v'].includes(ext))throw Error('Dosya uzantısı desteklenmiyor.');
 return origin+'/'+data.kind+'/'+encodeURIComponent(user)+'/'+encodeURIComponent(pass)+'/'+id+'.'+ext;
}
/**
 * Local-only media relay. FFprobe 5.2.0 lacks -max_redirects; passing media
 * directly to it would allow unsafe redirects. Here the origin is validated,
 * all DNS results must be public, the resolved IP is pinned for the request,
 * and each redirect is validated again. Range requests are forwarded for
 * seekable MP4/MKV streams. No public media proxy route is exposed.
 */
async function remotePublicAddress(u){
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('Medya kaynağında desteklenmeyen protokol.');
 const records=await lookup(u.hostname,{all:true,verbatim:true});
 if(!records.length||records.some(x=>!safeIp(x.address)))throw Error('Medya yönlendirmesi özel veya yerel bir IP adresine gidiyor.');
 return records[0].address;
}
function relayMedia(url,req,res,ticket,remaining=2){
 (async()=>{
  const u=new URL(url),pinned=await remotePublicAddress(u);
  if(!ticket||ticket.expiry<Date.now())throw Error('Medya oturumu süresi dolmuş.');
  const transport=u.protocol==='https:'?https:http;
  const headers={'User-Agent':'VLC/3.0.18','Accept':'*/*'};
  if(req.headers.range&&/^bytes=\d*-\d*$/.test(String(req.headers.range)))headers.Range=req.headers.range;
  const upstream=transport.request(u,{
   method:'GET',headers,timeout:12000,agent:false,
   lookup:(_host,_opts,cb)=>cb(null,pinned,isIP(pinned))
  },response=>{
   const status=Number(response.statusCode||502);
   if([301,302,303,307,308].includes(status)){
    response.resume();
    const location=response.headers.location;
    if(!location||remaining<=0){res.writeHead(502);res.end();return;}
    try{const next=new URL(location,u).toString();relayMedia(next,req,res,ticket,remaining-1);}
    catch(e){if(!res.headersSent){res.writeHead(502);res.end();}}
    return;
   }
   if(status!==200&&status!==206){
    response.resume();if(!res.headersSent){res.writeHead(502);res.end();}return;
   }
   const outHeaders={'Content-Type':String(response.headers['content-type']||'application/octet-stream')};
   for(const field of ['content-length','content-range','accept-ranges'])if(response.headers[field])outHeaders[field]=response.headers[field];
   res.writeHead(status,outHeaders);
   response.on('data',chunk=>{
    ticket.bytes+=chunk.length;
    if(ticket.bytes>MAX_UPSTREAM_BYTES){
     upstream.destroy();
     if(!res.destroyed)res.destroy();
    }
   });
   response.pipe(res);
  });
  upstream.on('timeout',()=>upstream.destroy(Error('Yayın sunucusu yanıt vermedi.')));
  upstream.on('error',()=>{if(!res.headersSent){res.writeHead(502);res.end();}else res.destroy();});
  res.on('close',()=>upstream.destroy());
  upstream.end();
 })().catch(()=>{if(!res.headersSent){res.writeHead(502);res.end();}});
}
const mediaProxy=http.createServer((req,res)=>{
 const match=String(req.url||'').match(/^\/([a-f0-9]{48})$/);
 if(req.method!=='GET'||!match){res.writeHead(404);res.end();return;}
 const ticket=mediaTickets.get(match[1]);
 if(!ticket||ticket.expiry<Date.now()){res.writeHead(404);res.end();return;}
 relayMedia(ticket.url,req,res,ticket);
});
function proxyUrl(token){return 'http://127.0.0.1:'+mediaProxyPort+'/'+token;}
function limited(req,res){
 const addr=String(req.socket.remoteAddress||'unknown'),now=Date.now();
 const entry=ratelimits.get(addr)||{time:now,count:0};
 if(now-entry.time>60000){entry.time=now;entry.count=0;}
 entry.count++;ratelimits.set(addr,entry);
 if(ratelimits.size>1000)ratelimits.clear();
 if(entry.count>40){error(res,429,'Çok fazla istek. Bir dakika sonra deneyin.');return true;}
 return false;
}
function readBody(req){
 return new Promise((resolve,reject)=>{
  let size=0,parts=[];
  req.on('data',p=>{size+=p.length;if(size>MAX_BODY){reject(Error('İstek çok büyük'));req.destroy();}else parts.push(p);});
  req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch(e){reject(Error('Geçersiz JSON'));}});
  req.on('error',reject);
 });
}
function collect(executable,args,timeout=PROBE_TIMEOUT,maxBytes=256000){
 return new Promise((resolve,reject)=>{
  let ended=false,bytes=0,chunks=[];
  const proc=spawn(executable,args,{stdio:['ignore','pipe','ignore'],windowsHide:true});
  const timer=setTimeout(()=>{proc.kill('SIGKILL');finish(Error('Analiz zaman aşımı.'));},timeout);
  function finish(err,value){if(ended)return;ended=true;clearTimeout(timer);if(err)reject(err);else resolve(value);}
  proc.on('error',()=>finish(Error('Medya analiz aracı bu sunucuda kullanılamıyor.')));
  proc.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){proc.kill('SIGKILL');finish(Error('Medya analiz çıktısı çok büyük.'));}else chunks.push(chunk);});
  proc.on('close',code=>{if(code!==0)finish(Error('Medya analizi başarısız oldu; kaynak veya codec desteklenmiyor.'));else finish(null,Buffer.concat(chunks).toString('utf8'));});
 });
}
function probeArgs(url,fallback=false){
 // First pass requests only essential stream fields; alternate pass uses the
 // full stream object for providers whose metadata is incomplete or nonstandard.
 const args=['-v','error','-user_agent','VLC/3.0.18','-protocol_whitelist','http,https,tcp,tls,crypto','-rw_timeout',fallback?'15000000':'9500000','-probesize',fallback?'8000000':'3000000','-analyzeduration',fallback?'9000000':'5000000'];
 if(fallback)args.push('-show_streams');
 else args.push('-show_entries','stream=index,codec_type,codec_name:stream_tags=language,title,LANGUAGE');
 args.push('-of','json',url);
 return args;
}
export function parseProbePayload(text){
 // FFprobe JSON ordinarily starts with "{". Handle optional UTF-8 BOM and
 // trailing non-JSON data without ever displaying or logging source URLs.
 const normalized=String(text||'').replace(/^\uFEFF/,'').trim();
 if(!normalized)throw Error('Medya analizi boş çıktı döndürdü.');
 let value;
 try{value=JSON.parse(normalized);}
 catch(e){
  const first=normalized.indexOf('{'),last=normalized.lastIndexOf('}');
  if(first<0||last<=first)throw Error('Medya analizi JSON yerine geçersiz veri döndürdü.');
  try{value=JSON.parse(normalized.slice(first,last+1));}
  catch(e2){throw Error('Medya analizi geçerli parça verisi döndürmedi.');}
 }
 if(!value||!Array.isArray(value.streams))throw Error('Medya analizi akış listesini döndürmedi.');
 return value;
}
export async function probeMedia(url,runner=collect){
 let firstError;
 for(let attempt=0;attempt<2;attempt++){
  try{
   const text=await runner(FFPROBE,probeArgs(url,attempt===1),attempt===0?10500:15000);
   const parsed=parseProbePayload(text);
   if(parsed.streams.some(x=>x.codec_type==='audio'||x.codec_type==='subtitle'))return parsed;
   firstError=Error('Kaynak ses veya altyazı parçası bildirmedi.');
  }catch(e){firstError=e;}
 }
 throw firstError||Error('Medya analizi tamamlanamadı.');
}
function normalizeStreams(raw){
 const streams=(raw.streams||[]).filter(s=>s.codec_type==='audio'||s.codec_type==='subtitle');
 return streams.map(s=>({index:Number(s.index),type:s.codec_type,codec:String(s.codec_name||'unknown'),language:String(s.tags?.language||s.tags?.LANGUAGE||'und').slice(0,32),title:String(s.tags?.title||'').slice(0,60),externalVtt: s.codec_type==='subtitle'&&['subrip','ass','ssa','mov_text','webvtt','text'].includes(String(s.codec_name||'').toLowerCase())})).filter(s=>Number.isInteger(s.index)&&s.index>=0&&s.index<256).slice(0,40);
}
function getSession(token){const s=sessions.get(token);if(!s||s.expiry<Date.now()){sessions.delete(token);mediaTickets.delete(token);return null;}return s;}
function sendStream(res,req,args,contentType,maxMs){
 let first=true,finished=false,bytesSent=0;
 const proc=spawn(FFMPEG,args,{stdio:['ignore','pipe','ignore'],windowsHide:true});
 const timeout=setTimeout(()=>proc.kill('SIGKILL'),maxMs);
 function done(){if(finished)return;finished=true;clearTimeout(timeout);activeStreams=Math.max(0,activeStreams-1);}
 proc.on('error',()=>{if(!res.headersSent)error(res,503,'FFmpeg çalıştırılamadı.');else res.end();done();});
 proc.stdout.on('data',chunk=>{
  bytesSent+=chunk.length;
  if(bytesSent>STREAM_BYTES){proc.kill('SIGKILL');return;}
  if(first){res.writeHead(200,{'Content-Type':contentType,'Cache-Control':'no-store','Access-Control-Expose-Headers':'Content-Type'});first=false;}
  if(!res.write(chunk)){proc.stdout.pause();res.once('drain',()=>proc.stdout.resume());}
 });
 proc.on('close',code=>{if(first&&!res.headersSent)error(res,502,'Bu medya akışı mevcut codec veya dosya biçimiyle açılamadı.');else res.end();done();});
 res.on('close',()=>{if(!res.writableEnded)proc.kill('SIGKILL');});
}
function cleanup(){for(const [k,v] of sessions)if(v.expiry<Date.now()){sessions.delete(k);mediaTickets.delete(k);}for(const [k,v] of mediaTickets)if(v.expiry<Date.now())mediaTickets.delete(k);}
const server=http.createServer(async(req,res)=>{
 const origin=req.headers.origin;
 if(origin&&allowOrigins.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
 if(req.method==='OPTIONS'){
  res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'});res.end();return;
 }
 if(limited(req,res))return;
 const pathname=new URL(req.url||'/', 'http://localhost').pathname;
 if(req.method==='GET'&&pathname==='/health'){json(res,200,{ok:true,service:'lg-media',ffprobeConfigured:!!FFPROBE,restrictedHosts:allowHosts.length});return;}
 if(req.method==='POST'&&pathname==='/tracks'){
  if(activeProbes>=1){error(res,429,'Bir analiz işlemi sürüyor. Biraz sonra tekrar deneyin.');return;}
  activeProbes++;
  try{
   const data=await readBody(req);
   const base=await validateHost(String(data.serverUrl||''),{username:data.username,password:data.password});
   const url=sourcePath(data,base);
   const token=randomBytes(24).toString('hex');
   const ticket={url,expiry:Date.now()+SESSION_TTL,bytes:0};
   mediaTickets.set(token,ticket);
   let parsed;
   try{parsed=await probeMedia(proxyUrl(token));}
   catch(e){mediaTickets.delete(token);throw e;}
   const streams=normalizeStreams(parsed);
   cleanup();
   if(sessions.size>=MAX_SESSIONS)sessions.delete(sessions.keys().next().value);
   sessions.set(token,{url,proxyUrl:proxyUrl(token),expiry:Date.now()+SESSION_TTL,streams});
   json(res,200,{success:true,token,expiresIn:Math.floor(SESSION_TTL/1000),tracks:streams,playback:{method:'mpegts-copy',experimental:true}});
  }catch(e){error(res,400,String(e.message||'Analiz başarısız').slice(0,150));}
  finally{activeProbes--;}
  return;
 }
 const match=pathname.match(/^\/(stream|subtitle)\/([a-f0-9]{48})\/([0-9]{1,3})(?:\.vtt)?$/);
 if(req.method==='GET'&&match){
  const [,type,token,indexStr]=match,s=getSession(token),index=Number(indexStr);
  if(!s){error(res,401,'Analiz oturumu sona erdi. Tekrar tarayın.');return;}
  const track=s.streams.find(t=>t.index===index&&t.type===(type==='stream'?'audio':'subtitle'));
  if(!track){error(res,400,'Bu parça medya kaynağında bulunmuyor.');return;}
  if(type==='subtitle'&&!track.externalVtt){error(res,422,'Bu altyazı biçimi webVTT olarak dönüştürülemiyor.');return;}
  if(activeStreams>=1){error(res,429,'Alternatif oynatma meşgul.');return;}
  activeStreams++;
  if(type==='stream'){
   const start=Math.max(0,Math.min(14400,Number(new URL(req.url,'http://localhost').searchParams.get('start'))||0));
   const args=['-nostdin','-v','error','-user_agent','VLC/3.0.18','-rw_timeout','12000000','-ss',String(start),'-i',s.proxyUrl,'-map','0:v:0','-map','0:'+index,'-c:v','copy','-c:a','copy','-f','mpegts','pipe:1'];
   sendStream(res,req,args,'video/mp2t',STREAM_SECONDS*1000);
  }else{
   const args=['-nostdin','-v','error','-rw_timeout','12000000','-i',s.url,'-map','0:'+index,'-c:s','webvtt','-f','webvtt','pipe:1'];
   sendStream(res,req,args,'text/vtt; charset=utf-8',90000);
  }
  return;
 }
 error(res,404,'Uç nokta bulunamadı.');
});
if(process.env.NODE_ENV!=='test')mediaProxy.listen(0,'127.0.0.1',()=>{
 mediaProxyPort=mediaProxy.address().port;
 server.listen(PORT,'0.0.0.0',()=>console.log('[lg-media] listening on port '+PORT+'; allowed upstream hosts: '+allowHosts.length+'; safe local relay ready'));
});
export {server,probeArgs,normalizeStreams,safeIp,mediaProxy};
