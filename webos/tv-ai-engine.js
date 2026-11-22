/* XIPTV Play TV AI Test: client-side stream inspector and bounded VOD auto-recovery.
 * ES5 only (LG webOS 2.0 / WebKit 538). Loaded ONLY by the experiment package.
 * Never touches Live TV. Credentials and full URLs are never displayed or stored.
 * It runs from the TV's own network, so it sees exactly what the TV sees. */
(function(root){
 'use strict';
 var VERSION='AI Test v1.0.81';
 var doc=root.document,video=doc&&doc.getElementById?doc.getElementById('video'):null;

 /* LG webOS TV 2.0 AV format table (official LG documentation, UHD models).
    Audio codecs listed per container. HLS segments follow the MPEG-TS row. */
 var LG={
  video:{
   mp4:{h264:1,hevc:1,mpeg4:1},
   mkv:{h264:1,hevc:1,mpeg2:1,mpeg4:1,vp8:1,vp9:1},
   ts:{h264:1,hevc:1,mpeg2:1},
   hls:{h264:1,hevc:1,mpeg2:1}
  },
  audio:{
   mp4:{aac:1,mp3:1},
   mkv:{ac3:1,dts:1,aac:1,mp3:1,pcm:1},
   ts:{aac:1,ac3:1,eac3:1,mp3:1,pcm:1},
   hls:{aac:1,ac3:1,eac3:1,mp3:1,pcm:1}
  }
 };

 /* ---------- tiny byte helpers (strings of 0..255 char codes) ---------- */
 function byte(s,i){return s.charCodeAt(i)&255;}
 function hex(n){var h=n.toString(16);return h.length<2?'0'+h:h;}
 function after(line){return line.slice(line.indexOf(':')+1);}
 function attrs(text){
  var out={},re=/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g,m,v;
  while((m=re.exec(text))){v=m[2];if(v.charAt(0)==='"')v=v.slice(1,-1);out[m[1]]=v;}
  return out;
 }
 function count(s,needle){var n=0,i=s.indexOf(needle);while(i>=0){n++;i=s.indexOf(needle,i+needle.length);}return n;}

 /* ---------- URL helpers ---------- */
 function hostOf(u){var m=/^https?:\/\/([^\/?#]+)/i.exec(String(u||''));return m?m[1].replace(/^[^@]*@/,''):'';}
 function maskHost(h){return String(h||'').replace(/^(.{3})[^.:]*/,'$1…');}
 function swapScheme(u){
  u=String(u||'');
  if(/^https:/i.test(u))return 'http:'+u.slice(6);
  if(/^http:/i.test(u))return 'https:'+u.slice(5);
  return u;
 }
 function resolveUrl(base,rel){
  rel=String(rel||'');base=String(base||'');
  if(/^https?:\/\//i.test(rel))return rel;
  var m=/^(https?:)\/\/([^\/?#]+)/i.exec(base);if(!m)return rel;
  if(rel.indexOf('//')===0)return m[1]+rel;
  if(rel.charAt(0)==='/')return m[1]+'//'+m[2]+rel;
  var path=base.replace(/[?#].*$/,'');
  return path.slice(0,path.lastIndexOf('/')+1)+rel;
 }
 function buildUrl(ctx,server,ext){
  return String(server).replace(/\/$/,'')+'/'+ctx.kind+'/'+encodeURIComponent(ctx.username)+'/'+encodeURIComponent(ctx.password)+'/'+encodeURIComponent(ctx.id)+'.'+ext;
 }
 /* Extensions to probe: the requested one first, then the usual Xtream alternatives. */
 function extensionCandidates(ext){
  var base=String(ext||'').toLowerCase(),all=['mp4','mkv','ts','m3u8'],out=[],i;
  if(/^[a-z0-9]{2,5}$/.test(base))out.push(base);
  for(i=0;i<all.length;i++)if(out.indexOf(all[i])<0)out.push(all[i]);
  return out;
 }

 /* ---------- codec naming ---------- */
 var AVC_PROFILES={66:'Baseline',77:'Main',88:'Extended',100:'High',110:'High10',122:'High422',244:'High444'};
 function avcDetail(profile,level){return ' '+(AVC_PROFILES[profile]||('p'+profile))+' L'+(level/10).toFixed(1);}
 function codecNames(str){
  var out={video:[],audio:[]},parts=String(str||'').split(','),i,c,m;
  for(i=0;i<parts.length;i++){
   c=parts[i].replace(/^\s+|\s+$/g,'');if(!c)continue;
   m=/^avc[1-4]\.([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c);
   if(m)out.video.push({n:'h264',d:avcDetail(parseInt(m[1],16),parseInt(m[3],16)).replace(/^ /,'')});
   else if(/^avc[1-4]/i.test(c))out.video.push({n:'h264',d:''});
   else if(/^(hvc1|hev1)/i.test(c))out.video.push({n:'hevc',d:''});
   else if(/^(vp09|vp9)/i.test(c))out.video.push({n:'vp9',d:''});
   else if(/^av01/i.test(c))out.video.push({n:'av1',d:''});
   else if(/^mp4a\.40\.2$/i.test(c))out.audio.push({n:'aac',d:'LC'});
   else if(/^mp4a\.40\.(5|29)$/i.test(c))out.audio.push({n:'aac',d:'HE'});
   else if(/^mp4a\.40\.1$/i.test(c))out.audio.push({n:'aac',d:'Main (LG desteklemez)'});
   else if(/^mp4a\.(69|6b)$/i.test(c))out.audio.push({n:'mp3',d:''});
   else if(/^mp4a/i.test(c))out.audio.push({n:'aac',d:''});
   else if(/^ac-3$/i.test(c))out.audio.push({n:'ac3',d:''});
   else if(/^ec-3$/i.test(c))out.audio.push({n:'eac3',d:''});
  }
  return out;
 }

 /* ---------- HLS manifest ---------- */
 function parseHls(text){
  var lines=String(text||'').replace(/^﻿/,'').split(/\r?\n/),r,pending=null,i,l,a;
  if(!lines.length||lines[0].replace(/\s+$/,'')!=='#EXTM3U')return null;
  r={master:false,version:0,variants:[],media:[],segments:[],segCount:0,endlist:false,byteRange:false,map:false,keyMethod:'',targetDuration:0,type:''};
  for(i=1;i<lines.length;i++){
   l=lines[i].replace(/^\s+|\s+$/g,'');if(!l)continue;
   if(l.indexOf('#EXT-X-VERSION:')===0)r.version=Number(after(l))||0;
   else if(l.indexOf('#EXT-X-STREAM-INF:')===0){r.master=true;pending=attrs(after(l));}
   else if(l.indexOf('#EXT-X-MEDIA:')===0){a=attrs(after(l));r.media.push({type:a.TYPE||'',group:a['GROUP-ID']||'',lang:a.LANGUAGE||a.NAME||'',uri:!!a.URI});}
   else if(l.indexOf('#EXT-X-TARGETDURATION:')===0)r.targetDuration=Number(after(l))||0;
   else if(l.indexOf('#EXT-X-PLAYLIST-TYPE:')===0)r.type=after(l);
   else if(l==='#EXT-X-ENDLIST')r.endlist=true;
   else if(l.indexOf('#EXT-X-BYTERANGE')===0)r.byteRange=true;
   else if(l.indexOf('#EXT-X-MAP:')===0)r.map=true;
   else if(l.indexOf('#EXT-X-KEY:')===0)r.keyMethod=attrs(after(l)).METHOD||'';
   else if(l.charAt(0)!=='#'){
    if(pending){r.variants.push({bandwidth:Number(pending.BANDWIDTH)||0,resolution:pending.RESOLUTION||'',codecs:pending.CODECS||'',audio:pending.AUDIO||'',uri:l});pending=null;}
    else{r.segCount++;if(r.segments.length<2)r.segments.push(l);}
   }
  }
  return r;
 }

 /* ---------- MPEG-TS: PAT/PMT ---------- */
 function tsSync(s){
  var i;
  for(i=0;i<188&&i+376<s.length;i++)if(byte(s,i)===0x47&&byte(s,i+188)===0x47&&byte(s,i+376)===0x47)return i;
  return -1;
 }
 function tsSection(s,start,pid){
  var p,pi,afc,o,ptr;
  for(p=start;p+188<=s.length;p+=188){
   if(byte(s,p)!==0x47)continue;
   pi=((byte(s,p+1)&0x1f)<<8)|byte(s,p+2);
   if(pi!==pid||!(byte(s,p+1)&0x40))continue;
   afc=(byte(s,p+3)>>4)&3;if(afc===2||afc===0)continue;
   o=p+4;if(afc===3)o+=1+byte(s,p+4);
   ptr=byte(s,o);o+=1+ptr;
   return s.substr(o,p+188-o);
  }
  return '';
 }
 var TS_VIDEO={0x01:'mpeg1video',0x02:'mpeg2',0x1b:'h264',0x24:'hevc',0xea:'vc1'};
 var TS_AUDIO={0x03:'mp3',0x04:'mp3',0x0f:'aac',0x11:'aac',0x81:'ac3',0x87:'eac3',0x82:'dts',0x8a:'dts'};
 function tsDescriptorAudio(s,from,to){
  var p=from,tag,len;
  while(p+2<=to){
   tag=byte(s,p);len=byte(s,p+1);
   if(tag===0x6a)return 'ac3';
   if(tag===0x7a)return 'eac3';
   if(tag===0x7b||tag===0x73)return 'dts';
   p+=2+len;
  }
  return '';
 }
 function parseTs(s){
  var start=tsSync(s),pat,pmtPid=-1,pmt,len,p,end,type,pid,esLen,out,name,pil;
  if(start<0)return null;
  pat=tsSection(s,start,0);
  if(pat.length<12||byte(pat,0)!==0)return {video:[],audio:[],error:'PAT okunamadı'};
  len=((byte(pat,1)&0x0f)<<8)|byte(pat,2);
  for(p=8;p+4<=Math.min(3+len-4,pat.length);p+=4){
   if(((byte(pat,p)<<8)|byte(pat,p+1))!==0){pmtPid=((byte(pat,p+2)&0x1f)<<8)|byte(pat,p+3);break;}
  }
  if(pmtPid<0)return {video:[],audio:[],error:'PMT PID yok'};
  pmt=tsSection(s,start,pmtPid);
  if(pmt.length<16||byte(pmt,0)!==2)return {video:[],audio:[],error:'PMT okunamadı'};
  len=((byte(pmt,1)&0x0f)<<8)|byte(pmt,2);
  pil=((byte(pmt,10)&0x0f)<<8)|byte(pmt,11);
  p=12+pil;end=Math.min(3+len-4,pmt.length);
  out={video:[],audio:[],other:[]};
  while(p+5<=end){
   type=byte(pmt,p);pid=((byte(pmt,p+1)&0x1f)<<8)|byte(pmt,p+2);esLen=((byte(pmt,p+3)&0x0f)<<8)|byte(pmt,p+4);
   if(TS_VIDEO[type])out.video.push({n:TS_VIDEO[type],d:''});
   else if(TS_AUDIO[type])out.audio.push({n:TS_AUDIO[type],d:''});
   else if(type===0x06){name=tsDescriptorAudio(pmt,p+5,Math.min(p+5+esLen,pmt.length));if(name)out.audio.push({n:name,d:''});else out.other.push('private');}
   else out.other.push('0x'+hex(type));
   p+=5+esLen;
  }
  return out;
 }

 /* ---------- Matroska: codec IDs in the Tracks element ---------- */
 var MKV_V={'V_MPEG4/ISO/AVC':'h264','V_MPEGH/ISO/HEVC':'hevc','V_VP9':'vp9','V_VP8':'vp8','V_AV1':'av1','V_MPEG2':'mpeg2','V_MPEG4/ISO/ASP':'mpeg4','V_MPEG4/ISO/SP':'mpeg4','V_MS/VFW/FOURCC':'vfw'};
 var MKV_A={'A_AAC':'aac','A_AC3':'ac3','A_EAC3':'eac3','A_DTS':'dts','A_TRUEHD':'truehd','A_OPUS':'opus','A_VORBIS':'vorbis','A_FLAC':'flac','A_MPEG/L3':'mp3','A_MPEG/L2':'mp3','A_PCM':'pcm'};
 function scanMkv(s){
  var out={video:[],audio:[],webm:s.substr(0,64).indexOf('webm')>=0},k,c;
  for(k in MKV_V)if(MKV_V.hasOwnProperty(k)){c=count(s,k);if(c)out.video.push({n:MKV_V[k],d:'',c:c});}
  for(k in MKV_A)if(MKV_A.hasOwnProperty(k)){c=count(s,k);if(c)out.audio.push({n:MKV_A[k],d:'',c:c});}
  return out;
 }

 /* ---------- MP4 boxes ---------- */
 function mp4Codecs(region){
  var out={video:[],audio:[]},i,pr,lv,lvl,d;
  if(region.indexOf('avc1')>=0||region.indexOf('avc3')>=0){
   i=region.indexOf('avcC');d='';
   if(i>=0&&i+8<region.length){pr=byte(region,i+5);lv=byte(region,i+7);d=(AVC_PROFILES[pr]||('p'+pr))+' L'+(lv/10).toFixed(1);}
   out.video.push({n:'h264',d:d});
  }
  if(region.indexOf('hvc1')>=0||region.indexOf('hev1')>=0){
   i=region.indexOf('hvcC');d='';
   if(i>=0&&i+17<region.length){pr=byte(region,i+5)&0x1f;lvl=byte(region,i+16);d=(pr===2?'Main10':pr===1?'Main':'p'+pr)+' L'+(lvl/30).toFixed(1);}
   out.video.push({n:'hevc',d:d});
  }
  if(region.indexOf('mp4v')>=0)out.video.push({n:'mpeg4',d:''});
  if(region.indexOf('vp09')>=0)out.video.push({n:'vp9',d:''});
  if(region.indexOf('av01')>=0)out.video.push({n:'av1',d:''});
  if(region.indexOf('mp4a')>=0)out.audio.push({n:'aac',d:'(mp3 olabilir)'});
  if(region.indexOf('ac-3')>=0)out.audio.push({n:'ac3',d:''});
  if(region.indexOf('ec-3')>=0)out.audio.push({n:'eac3',d:''});
  if(region.indexOf('Opus')>=0)out.audio.push({n:'opus',d:''});
  if(region.indexOf('fLaC')>=0)out.audio.push({n:'flac',d:''});
  return out;
 }
 function scanMp4(s){
  var p=0,guard=0,sz,ty,hdr,boxes=[],brand='',moov=null,out;
  while(p+8<=s.length&&guard++<64){
   sz=byte(s,p)*16777216+(byte(s,p+1)<<16)+(byte(s,p+2)<<8)+byte(s,p+3);ty=s.substr(p+4,4);hdr=8;
   if(sz===1&&p+16<=s.length){sz=byte(s,p+12)*16777216+(byte(s,p+13)<<16)+(byte(s,p+14)<<8)+byte(s,p+15);hdr=16;}
   boxes.push(ty);
   if(ty==='ftyp')brand=s.substr(p+8,4);
   if(ty==='moov'){moov=s.substr(p,Math.min(sz>0?sz:s.length-p,s.length-p));break;}
   if(ty==='mdat')break;
   if(sz<hdr)break;
   p+=sz;
  }
  out={brand:brand,moovFront:!!moov,moovAtEnd:!moov&&boxes.indexOf('mdat')>=0,video:[],audio:[]};
  if(moov){var c=mp4Codecs(moov);out.video=c.video;out.audio=c.audio;}
  return out;
 }
 function sniff(s){
  if(s.length>=4&&byte(s,0)===0x1a&&byte(s,1)===0x45&&byte(s,2)===0xdf&&byte(s,3)===0xa3)return 'mkv';
  if(s.length>=12&&s.substr(4,4)==='ftyp')return 'mp4';
  if(tsSync(s)>=0)return 'ts';
  return 'unknown';
 }

 /* ---------- decision against the LG webOS 2.0 table ---------- */
 var VERDICT_TEXT={
  'native-ok':'Codec ve kapsayıcı LG listesine uygun görünüyor.',
  'transcode-video':'Video dönüştürme gerekir (sunucu gerekir).',
  'transcode-audio':'Video kopyalanıp yalnız ses AAC yapılmalı (sunucu gerekir).',
  'manifest-fix':'HLS manifest düzeltmesi gerekir (hafif sunucu).',
  'unknown':'Codec bilgisi belirlenemedi.'
 };
 function decide(info){
  var c=info&&info.container,reasons=[],vOk=true,aOk=true,mOk=true,i,v,a,h;
  if(!c||!LG.video[c])return {verdict:'unknown',reasons:['Kapsayıcı tanınmadı.'],server:false};
  if(!(info.video&&info.video.length)&&!(info.audio&&info.audio.length))return {verdict:'unknown',reasons:['Codec bilgisi okunamadı.'],server:false};
  for(i=0;i<info.video.length;i++){
   v=info.video[i];
   if(!LG.video[c][v.n]){vOk=false;reasons.push('Video '+v.n+' bu kapsayıcıda LG webOS 2.0 listesinde yok.');}
   else if(/High(10|422|444)/.test(v.d||'')){vOk=false;reasons.push('H.264 10-bit/4:2:2 LG tarafından desteklenmiyor.');}
  }
  for(i=0;i<info.audio.length;i++){
   a=info.audio[i];
   if(!LG.audio[c][a.n]){aOk=false;reasons.push('Ses '+a.n+' '+c.toUpperCase()+' içinde LG listesinde yok.');}
   else if(/Main \(LG/.test(a.d||'')){aOk=false;reasons.push('AAC Main profili LG tarafından desteklenmiyor.');}
  }
  h=info.hls;
  if(c==='hls'&&h){
   if(h.media&&h.media.length){mOk=false;reasons.push('Manifest EXT-X-MEDIA (ayrı ses/altyazı grubu) içeriyor; webOS 2.0 desteklemiyor.');}
   if(h.byteRange){mOk=false;reasons.push('EXT-X-BYTERANGE webOS 2.0\'da yok.');}
   if(h.map){mOk=false;reasons.push('fMP4 HLS (EXT-X-MAP) webOS 2.0\'da yok.');}
   if(h.keyMethod&&h.keyMethod!=='NONE'&&h.keyMethod!=='AES-128'){mOk=false;reasons.push('Şifreleme '+h.keyMethod+' desteklenmiyor.');}
  }
  var verdict=!vOk?'transcode-video':!aOk?'transcode-audio':!mOk?'manifest-fix':'native-ok';
  return {verdict:verdict,reasons:reasons,server:verdict!=='native-ok'};
 }

 /* ---------- last known good (no credentials, no full URL) ---------- */
 var LKG_KEY='xiptv_ai_lkg_v1',LKG_TTL=30*24*3600*1000;
 function store(){try{return root.localStorage||null;}catch(e){return null;}}
 function lkgAll(){var s=store();try{return JSON.parse(s.getItem(LKG_KEY)||'{}')||{};}catch(e){return {};}}
 function lkgPut(all){var s=store();try{s.setItem(LKG_KEY,JSON.stringify(all));}catch(e){}}
 /* The memory is a rewrite RULE learned only when the AI engine found a different working
    extension/scheme: "when .from fails on this host, use .ext over .scheme". It is never
    learned from a normal successful start, so it cannot override titles that play fine. */
 function lkgRemember(kind,server,ext,from){
  var all=lkgAll();all[kind+'@'+hostOf(server)]={from:String(from||ext),ext:String(ext),scheme:/^https:/i.test(server)?'https':'http',at:new Date().getTime()};lkgPut(all);
 }
 function lkgForget(kind,server){var all=lkgAll();delete all[kind+'@'+hostOf(server)];lkgPut(all);}
 /* Applied before playback starts. Returns null when there is nothing to change. */
 function adjust(kind,server,ext){
  if(kind!=='movie'&&kind!=='series')return null;
  var rec=lkgAll()[kind+'@'+hostOf(server)],now=new Date().getTime(),want,srv=server;
  if(!rec||!rec.ext||rec.from!==ext||now-(rec.at||0)>LKG_TTL)return null;
  want=rec.scheme==='https'?'https':'http';
  if(/^https:/i.test(srv)&&want==='http')srv=swapScheme(srv);
  else if(/^http:/i.test(srv)&&want==='https')srv=swapScheme(srv);
  if(srv===server&&rec.ext===ext)return null;
  adjusted={kind:kind,server:srv};
  return {server:srv,ext:rec.ext};
 }
 var adjusted=null;

 /* ---------- network (browser only) ---------- */
 function probe(url,cb){
  var x=new XMLHttpRequest(),done=false,t=null;
  function finish(r){if(done)return;done=true;if(t)clearTimeout(t);try{x.abort();}catch(e){}cb(r);}
  try{
   x.open('GET',url,true);x.setRequestHeader('Range','bytes=0-0');
   x.onreadystatechange=function(){
    if(done||x.readyState<2)return;
    var cr=String(x.getResponseHeader('Content-Range')||''),m=/\/(\d+)$/.exec(cr);
    finish({status:x.status,type:String(x.getResponseHeader('Content-Type')||'').split(';')[0].toLowerCase(),
     total:m?Number(m[1]):Number(x.getResponseHeader('Content-Length')||0),
     ranges:x.status===206||/bytes/i.test(String(x.getResponseHeader('Accept-Ranges')||'')),
     host:hostOf(x.responseURL||'')});
   };
   x.onerror=function(){finish({status:0,err:'ağ/TLS hatası'});};
   t=setTimeout(function(){finish({status:0,err:'zaman aşımı'});},12000);
   x.send(null);
  }catch(e){finish({status:0,err:'istek hatası'});}
 }
 function fetchBytes(url,range,maxLen,cb){
  var x=new XMLHttpRequest(),done=false,t=null;
  function finish(err,text,status){if(done)return;done=true;if(t)clearTimeout(t);try{x.abort();}catch(e){}cb(err,text||'',status||0);}
  try{
   x.open('GET',url,true);x.overrideMimeType('text/plain; charset=x-user-defined');
   if(range)x.setRequestHeader('Range',range);
   x.onprogress=function(){var tx=x.responseText;if(!done&&x.status>=200&&x.status<300&&tx&&tx.length>=maxLen)finish(null,tx.substr(0,maxLen),x.status);};
   x.onload=function(){if(x.status<200||x.status>=300)finish(new Error('HTTP '+x.status),'',x.status);else finish(null,String(x.responseText||'').substr(0,maxLen),x.status);};
   x.onerror=function(){finish(new Error('ağ/TLS hatası'),'',0);};
   t=setTimeout(function(){var tx=x.responseText||'';if(tx.length>1000)finish(null,tx.substr(0,maxLen),x.status);else finish(new Error('zaman aşımı'),'',0);},15000);
   x.send(null);
  }catch(e){finish(e,'',0);}
 }

 /* Deep inspection of one URL: container + codecs, with the HLS chain followed. */
 function inspectHls(url,text,cb){
  var top=parseHls(text),pick,base=url,info;
  if(!top)return cb({container:'hls',error:'Manifest okunamadı.',video:[],audio:[]});
  function finishWith(media,mediaUrl,codecStr){
   info={container:'hls',hls:{master:top.master,version:media.version||top.version,media:top.media.concat(media.media),
    byteRange:media.byteRange||top.byteRange,map:media.map||top.map,keyMethod:media.keyMethod||top.keyMethod,
    variants:top.variants.length,endlist:media.endlist,type:media.type||top.type,targetDuration:media.targetDuration,segCount:media.segCount},video:[],audio:[]};
   var seg=media.segments[0],segUrl=seg?resolveUrl(mediaUrl,seg):'',m=/\.([a-z0-9]{1,5})(?:[?#]|$)/i.exec(seg||'');
   info.segExt=m?m[1].toLowerCase():'';
   if(!segUrl){var cn0=codecNames(codecStr);info.video=cn0.video;info.audio=cn0.audio;return cb(info);}
   fetchBytes(segUrl,'bytes=0-131999',132000,function(err,bytes){
    var cn=codecNames(codecStr),ts,mp;
    if(!err&&bytes){
     ts=parseTs(bytes);
     if(ts&&(ts.video.length||ts.audio.length)){info.video=ts.video;info.audio=ts.audio;info.segFormat='ts';return cb(info);}
     if(bytes.length>=12&&bytes.substr(4,4)==='ftyp'){mp=scanMp4(bytes);info.segFormat='fmp4';info.video=mp.video.length?mp.video:cn.video;info.audio=mp.audio.length?mp.audio:cn.audio;return cb(info);}
    }
    info.segError=err?err.message:'segment biçimi tanınmadı';
    info.video=cn.video;info.audio=cn.audio;cb(info);
   });
  }
  if(top.master&&top.variants.length){
   pick=top.variants[0];
   fetchBytes(resolveUrl(base,pick.uri),'bytes=0-65535',65536,function(err,t2){
    var media=err?null:parseHls(t2);
    if(!media){info={container:'hls',hls:{master:true,version:top.version,media:top.media,variants:top.variants.length},video:[],audio:[],error:'Varyant listesi alınamadı'};var cn=codecNames(pick.codecs);info.video=cn.video;info.audio=cn.audio;return cb(info);}
    finishWith(media,resolveUrl(base,pick.uri),pick.codecs);
   });
  }else finishWith(top,base,'');
 }
 function deepInspect(url,cb){
  fetchBytes(url,'bytes=0-98303',98304,function(err,head){
   var kind,m,mp,t;
   if(err)return cb({error:err.message,video:[],audio:[]});
   if(head.replace(/^﻿/,'').indexOf('#EXTM3U')===0)return inspectHls(url,head,cb);
   kind=sniff(head);
   if(kind==='mkv'){m=scanMkv(head);return cb({container:'mkv',webm:m.webm,video:m.video,audio:m.audio});}
   if(kind==='ts'){t=parseTs(head)||{video:[],audio:[]};return cb({container:'ts',video:t.video,audio:t.audio});}
   if(kind==='mp4'){
    mp=scanMp4(head);
    if(mp.moovFront||!mp.moovAtEnd)return cb({container:'mp4',brand:mp.brand,moovFront:mp.moovFront,video:mp.video,audio:mp.audio});
    fetchBytes(url,'bytes=-393216',393216,function(e2,tail){
     var c=e2?{video:[],audio:[]}:mp4Codecs(tail);
     cb({container:'mp4',brand:mp.brand,moovFront:false,moovAtEnd:true,video:c.video,audio:c.audio});
    });
    return;
   }
   cb({container:'unknown',video:[],audio:[],head:hex(byte(head,0))+hex(byte(head,1))+hex(byte(head,2))+hex(byte(head,3))});
  });
 }

 /* ---------- report overlay ---------- */
 var overlay=null,hideTimer=null,lines=[];
 function ensureOverlay(){
  if(overlay||!doc||!doc.createElement||!doc.body)return;
  overlay=doc.createElement('div');overlay.id='tv-ai-report';
  overlay.style.cssText='position:fixed;left:2vw;top:2vh;max-width:70vw;max-height:92vh;overflow:hidden;z-index:2147483000;background:rgba(6,16,24,.93);color:#e6f7ff;border:2px solid #3fb6c9;border-radius:10px;padding:14px 18px;font:21px/1.35 sans-serif;white-space:pre-wrap;pointer-events:none;display:none';
  doc.body.appendChild(overlay);
 }
 function render(keep){
  ensureOverlay();if(!overlay)return;
  overlay.textContent=lines.slice(-24).join('\n');overlay.style.display='block';
  if(hideTimer)clearTimeout(hideTimer);
  hideTimer=setTimeout(function(){if(overlay)overlay.style.display='none';},keep?180000:60000);
  var d=doc.getElementById('tv-vod-diagnostics');if(d)d.textContent=lines.join(' | ');
 }
 function log(line,keep){lines.push(String(line));render(keep);}
 function notice(text,kind){if(root.XIPTVPlayerUI&&root.XIPTVPlayerUI.notice)root.XIPTVPlayerUI.notice(text,kind||'info');}
 function fmtCodecs(list){
  var out=[],i;for(i=0;i<list.length;i++)out.push(list[i].n+(list[i].d?' '+list[i].d:'')+(list[i].c>1?' x'+list[i].c:''));
  return out.length?out.join(', '):'?';
 }
 function describeInfo(info){
  var s=info.container?info.container.toUpperCase():'?';
  if(info.error&&!info.container)return 'okunamadı: '+info.error;
  s+=' · video: '+fmtCodecs(info.video||[])+' · ses: '+fmtCodecs(info.audio||[]);
  if(info.hls){var h=info.hls;s+=' · HLS v'+(h.version||'?')+(h.media&&h.media.length?' · EXT-X-MEDIA:'+h.media.length:'')+(h.byteRange?' · BYTERANGE':'')+(h.map?' · fMP4':'')+(h.keyMethod?' · KEY:'+h.keyMethod:'')+(info.segExt?' · segment .'+info.segExt:'');}
  if(info.container==='mp4'&&info.moovAtEnd)s+=' · moov dosya sonunda';
  return s;
 }

 /* ---------- bounded playback attempt: only advancing currentTime counts ---------- */
 function attempt(url,cb){
  var done=false,seen=0,last=0,t=null,onErr,onTime;
  function end(ok,why){
   if(done)return;done=true;if(t)clearTimeout(t);
   video.removeEventListener('error',onErr,false);video.removeEventListener('timeupdate',onTime,false);
   if(!ok){try{video.pause();video.removeAttribute('src');video.load();}catch(e){}}
   cb(ok,why);
  }
  onErr=function(){end(false,'TV hata kodu '+(Number(video.error&&video.error.code)||0));};
  onTime=function(){var c=Number(video.currentTime)||0;if(!seen){if(c>0){seen=1;last=c;}return;}if(c>last+0.5)end(true,'');};
  try{video.pause();video.removeAttribute('src');video.load();}catch(e){}
  setTimeout(function(){
   if(done)return;
   video.addEventListener('error',onErr,false);video.addEventListener('timeupdate',onTime,false);
   t=setTimeout(function(){end(false,'20 sn içinde görüntü ilerlemesi yok');},20000);
   try{video.src=url;video.load();var p=video.play();if(p&&p.catch)p.catch(function(){});}catch(e){end(false,'başlatılamadı');}
  },450);
 }

 /* ---------- orchestration ---------- */
 var epoch=0,current=null,running=false,watch=null,button=null;
 function viable(ext,p){
  if(!p||(p.status!==200&&p.status!==206))return false;
  var t=p.type||'';
  if(/^text\/html|json|^text\/plain/.test(t)&&ext!=='m3u8')return false;
  if(ext==='m3u8'&&t&&!/mpegurl|octet-stream|text\/plain/.test(t))return false;
  return true;
 }
 function analyze(ctx,reason){
  if(!video||!ctx||running)return;
  running=true;var my=++epoch,exts=extensionCandidates(ctx.extension),probes={},alt=null,infos={},i=0;
  stopWatch();lines=[];
  log('XIPTV '+VERSION+' · tetik: '+reason+' · '+ctx.kind+' · uzantı .'+ctx.extension+' · sunucu '+maskHost(hostOf(ctx.serverUrl)),true);
  var errCode=Number(video.error&&video.error.code)||0;if(errCode)log('TV medya hata kodu: '+errCode,true);
  try{video.pause();video.removeAttribute('src');video.load();}catch(e){}
  function alive(){return my===epoch;}
  function stepProbe(){
   if(!alive())return;
   if(i>=exts.length)return stepAlt();
   var ext=exts[i++];
   probe(buildUrl(ctx,ctx.serverUrl,ext),function(p){
    if(!alive())return;
    probes[ext]=p;
    log('.'+ext+': '+(p.status?'HTTP '+p.status+' · '+(p.type||'tür yok')+(p.total?' · '+Math.round(p.total/1048576)+' MB':'')+(p.ranges?' · range':' · range yok'):'ERİŞİLEMEDİ ('+p.err+')'),true);
    stepProbe();
   });
  }
  function stepAlt(){
   if(!alive())return;
   var altServer=swapScheme(ctx.serverUrl);
   if(altServer===ctx.serverUrl)return stepDeep();
   probe(buildUrl(ctx,altServer,ctx.extension),function(p){
    if(!alive())return;
    alt={server:altServer,probe:p};
    log((/^https:/i.test(altServer)?'HTTPS':'HTTP')+' ile .'+ctx.extension+': '+(p.status?'HTTP '+p.status+' · '+(p.type||'tür yok'):'ERİŞİLEMEDİ ('+p.err+')'),true);
    stepDeep();
   });
  }
  var deepList=[],di=0;
  function stepDeep(){
   if(!alive())return;
   var k,e;
   for(k=0;k<exts.length&&deepList.length<2;k++){e=exts[k];if(viable(e,probes[e]))deepList.push(e);}
   nextDeep();
  }
  function nextDeep(){
   if(!alive())return;
   if(di>=deepList.length)return stepPlay();
   var ext=deepList[di++];
   deepInspect(buildUrl(ctx,ctx.serverUrl,ext),function(info){
    if(!alive())return;
    infos[ext]=info;
    var d=decide(info);info.decision=d;
    log('.'+ext+' içerik: '+describeInfo(info),true);
    if(d.reasons.length)log('  ! '+d.reasons.join(' '),true);
    log('  → '+VERDICT_TEXT[d.verdict],true);
    nextDeep();
   });
  }
  function stepPlay(){
   if(!alive())return;
   var plan=[],k,e,d,tries=0;
   for(k=0;k<exts.length;k++){
    e=exts[k];if(e===ctx.extension)continue;
    d=infos[e]&&infos[e].decision;
    if(viable(e,probes[e])&&(!d||d.verdict==='native-ok'||d.verdict==='unknown'))plan.push({label:'.'+e,url:buildUrl(ctx,ctx.serverUrl,e),ext:e,server:ctx.serverUrl});
   }
   if(alt&&viable(ctx.extension,alt.probe))plan.push({label:(/^https:/i.test(alt.server)?'HTTPS':'HTTP')+' .'+ctx.extension,url:buildUrl(ctx,alt.server,ctx.extension),ext:ctx.extension,server:alt.server});
   plan=plan.slice(0,3);
   if(!plan.length){return finish(null);}
   (function run(n){
    if(!alive())return;
    if(n>=plan.length)return finish(null);
    log('Deneniyor ('+(n+1)+'/'+plan.length+'): '+plan[n].label+' …',true);notice('AI: '+plan[n].label+' deneniyor…');
    attempt(plan[n].url,function(ok,why){
     if(!alive())return;
     if(ok){
      lkgRemember(ctx.kind,plan[n].server,plan[n].ext,ctx.extension);
      if(root.XIPTVPlaybackInfo){root.XIPTVPlaybackInfo.transport='ai-'+plan[n].ext;root.XIPTVPlaybackInfo.extension=plan[n].ext;root.XIPTVPlaybackInfo.terminal=false;}
      log('ÇALIŞTI: '+plan[n].label+' · sonraki oynatmalarda bu yöntem hatırlanacak.',true);notice('AI: '+plan[n].label+' ile oynatılıyor.');
      return finish(plan[n]);
     }
     log('  ✗ '+plan[n].label+': '+why,true);
     run(n+1);
    });
   })(0);
  }
  function finish(winner){
   running=false;if(!alive())return;
   if(!winner){
    var best=infos[ctx.extension]||infos[deepList[0]],d=best&&best.decision;
    log('SONUÇ: TV tarafında otomatik çalışan yol bulunamadı.'+(d?' '+VERDICT_TEXT[d.verdict]:''),true);
    log('Bu ekranın fotoğrafını gönderin.',true);notice('AI: oynatılamadı. Ekrandaki analizin fotoğrafını gönderin.','error');
   }
  }
  stepProbe();
 }

 /* ---------- startup watch (VOD only) ---------- */
 function stopWatch(){
  if(!watch)return;
  clearTimeout(watch.t);clearInterval(watch.poll);
  if(video){video.removeEventListener('error',watch.onErr,false);video.removeEventListener('timeupdate',watch.onTime,false);}
  watch=null;
 }
 function startWatch(ctx){
  stopWatch();if(!video)return;
  var w={fired:false,seen:0,last:0,age:0},hlsSeries=ctx.kind==='series'&&String(ctx.extension).toLowerCase()==='m3u8';
  function fire(reason){
   if(w.fired||watch!==w)return;w.fired=true;
   if(adjusted&&adjusted.kind===ctx.kind&&adjusted.server===ctx.serverUrl){lkgForget(ctx.kind,ctx.serverUrl);adjusted=null;}
   analyze(ctx,reason);
  }
  w.onErr=function(){if(!hlsSeries&&Number(video.error&&video.error.code)>0)fire('TV hata kodu');};
  w.onTime=function(){
   var c=Number(video.currentTime)||0;
   if(!w.seen){if(c>0){w.seen=1;w.last=c;}return;}
   if(c>w.last+0.6){stopWatch();adjusted=null;}
  };
  w.t=setTimeout(function(){if(!hlsSeries&&!video.paused&&!w.seen)fire('görüntü yok');},24000);
  w.poll=setInterval(function(){
   w.age++;
   var i=root.XIPTVPlaybackInfo;
   if(i&&i.terminal)fire('oynatıcı vazgeçti');
   else if(w.age>150){stopWatch();}
  },1000);
  video.addEventListener('error',w.onErr,false);video.addEventListener('timeupdate',w.onTime,false);
  watch=w;
 }

 /* ---------- wiring ---------- */
 function ensureButton(){
  if(button||!doc||!doc.getElementById)return;
  var anchor=doc.getElementById('tv-vod-diagnose');if(!anchor||!anchor.parentNode)return;
  button=doc.createElement('button');button.id='tv-ai-inspect';button.type='button';button.style.display='none';
  button.textContent='AI Analiz ve Otomatik Dene';
  button.onclick=function(){
   if(!current){notice('Önce bir film veya dizi bölümü seçin.','warning');return;}
   if(running){notice('Analiz sürüyor…','info');return;}
   analyze(current,'manuel');
  };
  anchor.parentNode.insertBefore(button,anchor.nextSibling);
 }
 function wrapSource(){
  var lg=root.XIPTVLGMedia;
  if(!lg||!lg.setSource||lg.__aiWrapped)return;
  var original=lg.setSource;
  lg.setSource=function(data){
   original.apply(lg,arguments);
   epoch++;running=false;stopWatch();lines=[];
   if(overlay)overlay.style.display='none';
   current=data&&(data.kind==='movie'||data.kind==='series')?data:null;
   ensureButton();
   if(button)button.style.display=current?'inline-block':'none';
   if(current)startWatch(current);
  };
  lg.__aiWrapped=true;
 }
 function init(){
  if(root.XIPTVVODRecovery)root.XIPTVVODRecovery.start=function(){return false;}; /* the AI engine owns VOD recovery in this build */
  wrapSource();ensureButton();
 }
 root.XIPTVAIEngine={version:VERSION,adjust:adjust,analyze:function(){if(current)analyze(current,'manuel');},
  _test:{mp4Codecs:mp4Codecs,parseHls:parseHls,codecNames:codecNames,parseTs:parseTs,scanMkv:scanMkv,scanMp4:scanMp4,sniff:sniff,decide:decide,
   extensionCandidates:extensionCandidates,resolveUrl:resolveUrl,swapScheme:swapScheme,maskHost:maskHost,hostOf:hostOf,buildUrl:buildUrl,
   lkgRemember:lkgRemember,lkgForget:lkgForget,describeInfo:describeInfo,viable:viable,VERDICT_TEXT:VERDICT_TEXT}};
 if(video)init();
})(typeof window!=='undefined'?window:this);
