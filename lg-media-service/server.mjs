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
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';

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
const mp4Clips=new Map();
const MP4_CLIP_SECONDS=8,MP4_CLIP_MAX_BYTES=4*1024*1024,MP4_CLIP_TTL=5*60*1000;
const subtitleJobs=new Map();
const subtitleCache=new Map();
const SUBTITLE_CACHE_TTL=10*60*1000;
const MAX_SUBTITLE_CACHE_ENTRIES=8;
const MAX_UPSTREAM_BYTES=85*1024*1024;
const MAX_SUBTITLE_INPUT_BYTES=2*1024*1024*1024;
const MAX_SUBTITLE_OUTPUT_BYTES=2*1024*1024;
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
   // Tek bir doğrulanmış IP sabitlendiği için Node'dan adres dizisi istemesini engelle.
   autoSelectFamily:false,
   lookup:(_host,_opts,cb)=>cb(null,pinned,isIP(pinned))
  },response=>{
   const status=Number(response.statusCode||502);
   ticket.lastStatus=status;
   ticket.lastType=String(response.headers['content-type']||'').split(';')[0].slice(0,80);
   if([301,302,303,307,308].includes(status)){
    response.resume();
    const location=response.headers.location;
    if(!location||remaining<=0){ticket.lastError='Medya yönlendirmesi sınırı aşıldı';res.writeHead(502);res.end();return;}
    try{const next=new URL(location,u).toString();relayMedia(next,req,res,ticket,remaining-1);}
    catch(e){if(!res.headersSent){res.writeHead(502);res.end();}}
    return;
   }
   if(status!==200&&status!==206){
    ticket.lastError='Yayın sunucusu HTTP '+status+' döndürdü';
    response.resume();if(!res.headersSent){res.writeHead(502);res.end();}return;
   }
   const outHeaders={'Content-Type':String(response.headers['content-type']||'application/octet-stream')};
   for(const field of ['content-length','content-range','accept-ranges'])if(response.headers[field])outHeaders[field]=response.headers[field];
   res.writeHead(status,outHeaders);
   response.on('data',chunk=>{
    ticket.bytes+=chunk.length;
    if(ticket.bytes>(ticket.maxBytes||MAX_UPSTREAM_BYTES)){
     upstream.destroy();
     if(!res.destroyed)res.destroy();
    }
   });
   response.pipe(res);
  });
  upstream.on('timeout',()=>upstream.destroy(Error('Yayın sunucusu yanıt vermedi.')));
  upstream.on('error',(err)=>{ticket.lastError=err&&err.code==='ETIMEDOUT'?'Yayın sunucusu zaman aşımı':'Yayın sunucusu TCP/TLS bağlantısı başarısız';if(!res.headersSent){res.writeHead(502);res.end();}else res.destroy();});
  res.on('close',()=>upstream.destroy());
  upstream.end();
 })().catch((err)=>{if(ticket)ticket.lastError=String(err&&err.message||'Yayın aktarma sorunu').replace(/https?:\/\/\S+/gi,'[url]').slice(0,100);if(!res.headersSent){res.writeHead(502);res.end();}});
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
 if(entry.count>40){
  console.warn('[lg-media] request rate limit reached');
  res.setHeader('Retry-After',String(Math.max(1,Math.ceil((60000-now+entry.time)/1000))));
  error(res,429,'Çok fazla istek. Bir dakika sonra deneyin.');return true;
 }
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
/* Short, URL-free summary of FFprobe stderr so the TV can show the real reason (e.g. HTTP 403). */
function diagnose(text){
 const t=String(text||'').replace(/https?:\/\/\S+/gi,'[url]').replace(/(user(name)?|pass(word)?)=\S+/gi,'$1=[redacted]').replace(/\s+/g,' ').trim();
 const code=(t.match(/(?:HTTP error|Server returned|returned error|status code)[^0-9]{0,12}(\d{3})/i)||[])[1];
 const tail=t.split(' ').slice(-18).join(' ').slice(0,140);
 return (code?'HTTP '+code+' - ':'')+(tail||'FFprobe çıktı vermedi');
}
function collect(executable,args,timeout=PROBE_TIMEOUT,maxBytes=256000){
 return new Promise((resolve,reject)=>{
  let ended=false,bytes=0,chunks=[],errText='';
  const proc=spawn(executable,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});
  proc.stderr.on('data',chunk=>{if(errText.length<4000)errText+=String(chunk);});
  const timer=setTimeout(()=>{proc.kill('SIGKILL');finish(Error('Analiz zaman aşımı.'));},timeout);
  function finish(err,value){if(ended)return;ended=true;clearTimeout(timer);if(err)reject(err);else resolve(value);}
  proc.on('error',()=>finish(Error('Medya analiz aracı bu sunucuda kullanılamıyor.')));
  proc.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){proc.kill('SIGKILL');finish(Error('Medya analiz çıktısı çok büyük.'));}else chunks.push(chunk);});
  proc.on('close',(code,signal)=>{if(code!==0)finish(Error('Medya analizi başarısız: '+(signal?'FFprobe sinyal '+String(signal).slice(0,24):errText.trim()?diagnose(errText):'FFprobe çıktı vermedi (çıkış kodu '+String(code)+')')));else finish(null,Buffer.concat(chunks).toString('utf8'));});
 });
}
function probeArgs(url,fallback=false){
 // First pass requests only essential stream fields; alternate pass uses the
 // full stream object for providers whose metadata is incomplete or nonstandard.
 const args=['-v','error','-user_agent','VLC/3.0.18','-protocol_whitelist','http,https,tcp,tls,crypto','-rw_timeout',fallback?'15000000':'9500000','-probesize',fallback?'8000000':'3000000','-analyzeduration',fallback?'9000000':'5000000'];
 if(fallback)args.push('-show_streams');
 else args.push('-show_entries','stream=index,codec_type,codec_name,profile,width,height:stream_tags=language,title,LANGUAGE');
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
   if(parsed.streams.some(x=>x.codec_type==='video'||x.codec_type==='audio'||x.codec_type==='subtitle'))return parsed;
   firstError=Error('Kaynak ses veya altyazı parçası bildirmedi.');
  }catch(e){firstError=e;}
 }
 throw firstError||Error('Medya analizi tamamlanamadı.');
}
export function shouldBypassCrashedProbe(message,ticket){
 if(!ticket||ticket.lastError)return false;
 if(ticket.lastStatus!==200&&ticket.lastStatus!==206)return false;
 if(!/FFprobe sinyal SIGSEGV/.test(String(message||'')))return false;
 return /^(video\/mp2t|video\/x-matroska|video\/mp4)$/i.test(String(ticket.lastType||''));
}
function normalizeStreams(raw){
 const streams=(raw.streams||[]).filter(s=>s.codec_type==='video'||s.codec_type==='audio'||s.codec_type==='subtitle');
 return streams.map(s=>({index:Number(s.index),type:s.codec_type,codec:String(s.codec_name||'unknown'),profile:String(s.profile||'').slice(0,40),width:Math.max(0,Math.min(7680,Number(s.width)||0)),height:Math.max(0,Math.min(4320,Number(s.height)||0)),language:String(s.tags?.language||s.tags?.LANGUAGE||'und').slice(0,32),title:String(s.tags?.title||'').slice(0,60),externalVtt: s.codec_type==='subtitle'&&['subrip','ass','ssa','mov_text','webvtt','text'].includes(String(s.codec_name||'').toLowerCase())})).filter(s=>Number.isInteger(s.index)&&s.index>=0&&s.index<256).slice(0,40);
}
function getSession(token){const s=sessions.get(token);if(!s||s.expiry<Date.now()){sessions.delete(token);mediaTickets.delete(token);return null;}return s;}
// Experimental low-resolution compatibility path; one process, bounded duration
// and byte count. Transcode is explicitly requested, never used for live TV.
export function compatibilityArgs(proxySource,start=0,audioIndex=null){
 const begin=Math.max(0,Math.min(14400,Number(start)||0));
 const args=['-nostdin','-v','error','-rw_timeout','12000000','-ss',String(begin),
  '-i',proxySource,'-map','0:v:0'];
 if(Number.isInteger(audioIndex)&&audioIndex>=0&&audioIndex<256)args.push('-map','0:'+audioIndex);
 else args.push('-map','0:a:0?');
 args.push('-sn','-dn','-vf','scale=w=640:h=360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,fps=20',
  '-c:v','libx264','-preset','ultrafast','-profile:v','baseline','-level:v','3.0',
  '-pix_fmt','yuv420p','-b:v','650k','-maxrate','800k','-bufsize','1600k','-threads','2',
  '-c:a','aac','-profile:a','aac_low','-ac','2','-ar','44100','-b:a','96k',
  '-t',String(STREAM_SECONDS),'-f','mpegts','pipe:1');
 return args;
}
// Produce a *complete* MP4 with a normal moov atom, then serve with Range
// support. A live pipe cannot safely use +faststart (requires seekable output).
export function mp4ClipArgs(proxySource,outputPath,start=0,audioIndex=null){
 const args=compatibilityArgs(proxySource,start,audioIndex);
 const fmt=args.lastIndexOf('-f');
 args.splice(fmt-2,5,'-t',String(MP4_CLIP_SECONDS),'-movflags','+faststart','-f','mp4',outputPath);
 return args;
}
async function prepareMp4Clip(session,start){
 const dir=await fs.mkdtemp(path.join(tmpdir(),'lg-vod-'));
 const outputPath=path.join(dir,'sample.mp4');
 const selectedAudio=session.streams.find(t=>t.type==='audio');
 const args=mp4ClipArgs(session.proxyUrl,outputPath,start,selectedAudio?selectedAudio.index:null);
 let errText='',settled=false;
 try{
  await new Promise((resolve,reject)=>{
   const proc=spawn(FFMPEG,args,{stdio:['ignore','ignore','pipe'],windowsHide:true});
   const timer=setTimeout(()=>proc.kill('SIGKILL'),80000);
   proc.stderr.on('data',chunk=>{if(errText.length<1600)errText+=String(chunk).slice(0,1600);});
   proc.on('error',err=>{if(!settled){settled=true;clearTimeout(timer);reject(Error('FFmpeg başlatılamadı.'));}});
   proc.on('close',(code,signal)=>{
    if(settled)return;settled=true;clearTimeout(timer);
    if(code===0&&!signal)resolve();
    else {
     console.warn('[lg-media] MP4 clip failed code='+String(code)+' signal='+String(signal||'none')+' detail='+diagnose(errText));
     reject(Error(signal?'FFmpeg '+String(signal):'FFmpeg çıkış '+String(code)));
    }
   });
  });
  const stat=await fs.stat(outputPath);
  if(stat.size<2048||stat.size>MP4_CLIP_MAX_BYTES)throw Error('MP4 çıktı boyutu geçersiz.');
  const bytes=await fs.readFile(outputPath);
  // A complete MP4 must contain the normal file type and movie index atoms.
  if(bytes.toString('latin1',4,8)!=='ftyp'||!bytes.includes(Buffer.from('moov')))throw Error('MP4 dosyası tamamlanamadı.');
  return bytes;
 }finally{await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
export function parseByteRange(header,size){
 if(!header)return {start:0,end:size-1,status:200};
 const match=String(header).match(/^bytes=(\d*)-(\d*)$/);
 if(!match)return null;
 let start=match[1]?Number(match[1]):null,end=match[2]?Number(match[2]):null;
 if(start===null){if(end===null||end<=0)return null;start=Math.max(0,size-end);end=size-1;}
 else if(end===null)end=size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||start<0||end<start)return null;
 return {start,end:Math.min(end,size-1),status:206};
}
function sendStream(res,req,args,contentType,maxMs){
 let first=true,finished=false,bytesSent=0;
 const proc=spawn(FFMPEG,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let ffmpegError='';
 proc.stderr.on('data',chunk=>{if(ffmpegError.length<1200)ffmpegError+=String(chunk).slice(0,1200);});
 const timeout=setTimeout(()=>proc.kill('SIGKILL'),maxMs);
 function done(){if(finished)return;finished=true;clearTimeout(timeout);activeStreams=Math.max(0,activeStreams-1);}
 proc.on('error',()=>{if(!res.headersSent)error(res,503,'FFmpeg çalıştırılamadı.');else res.end();done();});
 proc.stdout.on('data',chunk=>{
  bytesSent+=chunk.length;
  if(bytesSent>STREAM_BYTES){proc.kill('SIGKILL');return;}
  if(first){console.info('[lg-media] compatible media produced bytes: type='+contentType);res.writeHead(200,{'Content-Type':contentType,'Cache-Control':'no-store','Access-Control-Expose-Headers':'Content-Type'});first=false;}
  if(!res.write(chunk)){proc.stdout.pause();res.once('drain',()=>proc.stdout.resume());}
 });
 proc.on('close',(code,signal)=>{
  if(code!==0||signal)console.warn('[lg-media] converter finished with code='+String(code)+' signal='+String(signal||'none')+' bytes='+bytesSent+' detail='+diagnose(ffmpegError));
  if(first&&!res.headersSent)error(res,502,'Uyumlu dönüştürme başlatılamadı ('+(signal?'FFmpeg '+String(signal).slice(0,16):'FFmpeg çıkış '+String(code))+').');else res.end();done();
 });
 res.on('close',()=>{if(!res.writableEnded)proc.kill('SIGKILL');});
}
function cleanup(){for(const [k,v] of sessions)if(v.expiry<Date.now()){sessions.delete(k);mediaTickets.delete(k);mp4Clips.delete(k);}for(const [k,v] of mediaTickets)if(v.expiry<Date.now())mediaTickets.delete(k);for(const [k,v] of mp4Clips)if(v.expiry<Date.now())mp4Clips.delete(k);}
async function extractSubtitle(url,index){
 // Tam altyazı taraması için analiz kotasından ayrı bir medya bileti kullan.
 const token=randomBytes(24).toString('hex');
 mediaTickets.set(token,{url,expiry:Date.now()+90000,bytes:0,maxBytes:MAX_SUBTITLE_INPUT_BYTES});
 try{
  const args=['-nostdin','-v','error','-xerror','-protocol_whitelist','http,tcp','-rw_timeout','12000000','-i',proxyUrl(token),'-map','0:'+index,'-c:s','webvtt','-f','webvtt','pipe:1'];
  const vtt=await collect(FFMPEG,args,90000,MAX_SUBTITLE_OUTPUT_BYTES);
  if(!vtt.startsWith('WEBVTT'))throw Error('Geçerli altyazı verisi üretilemedi.');
  return vtt;
 }catch(e){
  console.warn('[lg-media] subtitle extraction failed: '+diagnose(e.message));
  throw e;
 }finally{
  mediaTickets.delete(token);
 }
}
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
   const ticket={url,expiry:Date.now()+SESSION_TTL,bytes:0,lastStatus:0,lastType:'',lastError:''};
   mediaTickets.set(token,ticket);
   let parsed=null,probeFallback=false;
   try{parsed=await probeMedia(proxyUrl(token));}
   catch(e){
      // Some providers label MKV files but return MPEG-TS. The bundled
      // ffprobe binary can crash with SIGSEGV on these streams.
      // Never approve an arbitrary URL: the host/account were verified above,
      // and upstream must have returned actual video media status/type.
      if(shouldBypassCrashedProbe(e.message,ticket)){
        probeFallback=true;
        parsed={streams:[{index:0,codec_type:'video',codec_name:'unknown'}]};
        // No guessed audio track index; FFmpeg selects the first available audio.
      }else{
        const reason=ticket.lastError||('Yayın HTTP '+ticket.lastStatus+(ticket.lastType?' · '+ticket.lastType:''));
        mediaTickets.delete(token);
        throw Error(String(e.message||'Analiz başarısız')+' | Kaynak: '+reason);
      }
   }
   const streams=normalizeStreams(parsed);
   cleanup();
   if(sessions.size>=MAX_SESSIONS)sessions.delete(sessions.keys().next().value);
   sessions.set(token,{url,proxyUrl:proxyUrl(token),expiry:Date.now()+SESSION_TTL,streams});
   json(res,200,{success:true,token,expiresIn:Math.floor(SESSION_TTL/1000),tracks:streams,probeFallback,playback:{method:'mpegts-copy',compatibility:'h264-aac-ts-360p',experimental:true}});
  }catch(e){error(res,400,String(e.message||'Analiz başarısız').slice(0,150));}
  finally{activeProbes--;}
  return;
 }
 // Experimental 8-second complete MP4 test for legacy LG devices.
 // Do not expose an arbitrary URL: only sessions created via authenticated
 // /tracks can request a clip, with one bounded FFmpeg process at a time.
 const mp4Prepare=pathname.match(/^\/compat-mp4\/prepare\/([a-f0-9]{48})$/);
 if(req.method==='POST'&&mp4Prepare){
  const token=mp4Prepare[1],sess=getSession(token);
  if(!sess){error(res,401,'Medya oturumu sona erdi; yeniden analiz edin.');return;}
  if(!sess.streams.some(t=>t.type==='video')){error(res,422,'Medya video içermiyor.');return;}
  if(activeStreams>=1){res.setHeader('Retry-After','5');error(res,429,'Dönüştürücü başka bir işlemle meşgul.');return;}
  activeStreams++;
  try{
   // The clip is intentionally short. This is a compatibility test, not full playback.
   const output=await prepareMp4Clip(sess,0);
   mp4Clips.set(token,{bytes:output,expiry:Math.min(sess.expiry,Date.now()+MP4_CLIP_TTL)});
   cleanup();
   json(res,200,{success:true,format:'mp4',seconds:MP4_CLIP_SECONDS,bytes:output.length,path:'/compat-mp4/file/'+token});
  }catch(e){error(res,502,'MP4 denemesi üretilemedi: '+String(e.message||'Dönüştürme hatası').slice(0,80));}
  finally{activeStreams--;}
  return;
 }
 const mp4File=pathname.match(/^\/compat-mp4\/file\/([a-f0-9]{48})$/);
 if((req.method==='GET'||req.method==='HEAD')&&mp4File){
  const sess=getSession(mp4File[1]),clip=mp4Clips.get(mp4File[1]);
  if(!sess||!clip||clip.expiry<Date.now()){error(res,404,'MP4 denemesi bulunamadı veya süresi doldu.');return;}
  const bytes=clip.bytes,range=parseByteRange(req.headers.range,bytes.length);
  if(!range){res.writeHead(416,{'Content-Range':'bytes */'+bytes.length});res.end();return;}
  res.writeHead(range.status,{'Content-Type':'video/mp4','Content-Length':range.end-range.start+1,
   'Accept-Ranges':'bytes','Cache-Control':'private, max-age=0','X-Content-Type-Options':'nosniff',
   ...(range.status===206?{'Content-Range':'bytes '+range.start+'-'+range.end+'/'+bytes.length}:{})});
  res.end(req.method==='HEAD'?undefined:bytes.subarray(range.start,range.end+1));
  return;
 }
 // Short-lived token from authenticated /tracks. No source URL is exposed.
 const compat=pathname.match(/^\/compat\/([a-f0-9]{48})$/);
 if(req.method==='GET'&&compat){
  const sess=getSession(compat[1]);
  if(!sess){error(res,401,'Uyumluluk oturumu sona erdi. Tekrar analiz edin.');return;}
  if(!sess.streams.some(t=>t.type==='video')){error(res,422,'Bu kaynakta video akışı bulunamadı.');return;}
  if(activeStreams>=1){res.setHeader('Retry-After','5');error(res,429,'Medya dönüştürücü meşgul.');return;}
  const pos=Math.max(0,Math.min(14400,Number(new URL(req.url,'http://localhost').searchParams.get('start'))||0));
  const selectedAudio=sess.streams.find(t=>t.type==='audio');
  console.info('[lg-media] compatible VOD requested: tracks='+sess.streams.length+' seek='+pos+' active='+activeStreams);
  activeStreams++;
  sendStream(res,req,compatibilityArgs(sess.proxyUrl,pos,selectedAudio?selectedAudio.index:null),'video/mp2t',STREAM_SECONDS*1000);
  return;
 }
 const match=pathname.match(/^\/(stream|subtitle)\/([a-f0-9]{48})\/([0-9]{1,3})(?:\.vtt)?$/);
 if(req.method==='GET'&&match){
  const [,type,token,indexStr]=match,s=getSession(token),index=Number(indexStr);
  if(!s){error(res,401,'Analiz oturumu sona erdi. Tekrar tarayın.');return;}
  const track=s.streams.find(t=>t.index===index&&t.type===(type==='stream'?'audio':'subtitle'));
  if(!track){error(res,400,'Bu parça medya kaynağında bulunmuyor.');return;}
  if(type==='subtitle'){
   if(!track.externalVtt){error(res,422,'Bu altyazı biçimi webVTT olarak dönüştürülemiyor.');return;}
   const key=s.url+'\n'+index;
   const cached=subtitleCache.get(key);
   let job=subtitleJobs.get(key);
   if(cached&&cached.expiry>Date.now()){
    job=Promise.resolve(cached.vtt);
   }else if(!job){
    subtitleCache.delete(key);
    if(activeStreams>=1){
     console.warn('[lg-media] subtitle worker busy');
     res.setHeader('Retry-After','5');
     error(res,429,'Altyazı hazırlama işlemi meşgul. Biraz sonra tekrar deneyin.');
     return;
    }
    activeStreams++;
    job=extractSubtitle(s.url,index).then(vtt=>{
     if(subtitleCache.size>=MAX_SUBTITLE_CACHE_ENTRIES)subtitleCache.delete(subtitleCache.keys().next().value);
     subtitleCache.set(key,{vtt,expiry:Date.now()+SUBTITLE_CACHE_TTL});
     return vtt;
    }).finally(()=>{
     subtitleJobs.delete(key);
     activeStreams--;
    });
    subtitleJobs.set(key,job);
   }
   try{
    const vtt=await job;
    if(!res.destroyed){
     res.writeHead(200,{'Content-Type':'text/vtt; charset=utf-8','Cache-Control':'no-store'});
     res.end(vtt);
    }
   }catch(e){
    if(!res.destroyed)error(res,502,'Altyazı çıkarılamadı.');
   }
   return;
  }
  if(activeStreams>=1){error(res,429,'Alternatif oynatma meşgul.');return;}
  activeStreams++;
  const start=Math.max(0,Math.min(14400,Number(new URL(req.url,'http://localhost').searchParams.get('start'))||0));
  const args=['-nostdin','-v','error','-user_agent','VLC/3.0.18','-rw_timeout','12000000','-ss',String(start),'-i',s.proxyUrl,'-map','0:v:0','-map','0:'+index,'-c:v','copy','-c:a','copy','-f','mpegts','pipe:1'];
  sendStream(res,req,args,'video/mp2t',STREAM_SECONDS*1000);
  return;
 }
 error(res,404,'Uç nokta bulunamadı.');
});
if(process.env.NODE_ENV!=='test')mediaProxy.listen(0,'127.0.0.1',()=>{
 mediaProxyPort=mediaProxy.address().port;
 server.listen(PORT,'0.0.0.0',()=>console.log('[lg-media] listening on port '+PORT+'; allowed upstream hosts: '+allowHosts.length+'; safe local relay ready'));
});
export {server,probeArgs,normalizeStreams,safeIp,mediaProxy};
