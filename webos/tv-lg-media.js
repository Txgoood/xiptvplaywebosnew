/* Optional LG media companion for webOS 2 (ES5 only). Native TS playback remains default.
   Configured only after a separate media service has been approved/deployed. */
(function(){
 var video=document.getElementById('video'),url=String(window.XIPTV_LG_MEDIA_URL||'').replace(/\/+$/,'');
 var ctx=null,session=null,busy=false,busySince=0,manual=false,started=false,offset=0,scanSequence=0;
 var playerOverlay=document.getElementById('tv-lg-subtitle-overlay'),cues=[],lastCue=-1,sourceKey='';
 var scanButton=document.getElementById('tv-lg-media-scan'),summary=document.getElementById('tv-lg-media-status'),returnButton=document.getElementById('tv-lg-native-return');
 function say(s){summary.textContent=String(s||'');}
 function request(method,path,data,cb,timeoutMs){
  var x=new XMLHttpRequest();
  try{x.open(method,url+path,true);x.timeout=timeoutMs||28000;
    if(data)x.setRequestHeader('Content-Type','application/json');
    x.onreadystatechange=function(){if(x.readyState!==4)return;var result=null;try{result=JSON.parse(x.responseText);}catch(e){}
      if(x.status<200||x.status>=300){cb(new Error(result&&result.error||'HTTP '+x.status));return;}
      cb(null,result);
    };x.onerror=function(){cb(new Error('LG medya sunucusuna bağlantı kurulamadı.'));};
    x.ontimeout=function(){cb(new Error('Parça listesi zaman aşımı.'));};
    x.send(data?JSON.stringify(data):null);
  }catch(e){cb(e);}
 }
 function isTr(track){var v=String(track.language||'').toLowerCase()+' '+String(track.title||'').toLowerCase();return /(^|[^a-z])(tr|tur|turkish|türkçe)([^a-z]|$)/i.test(v);}
 function addOption(sel,label,value){
  for(var n=0;n<sel.options.length;n++)if(sel.options[n].value===value)return;
  var o=document.createElement('option');o.value=value;o.textContent=label;sel.appendChild(o);
 }
 /* Render free instances sleep and need up to ~60 s to wake; one short attempt used to fail silently. */
 function wake(cb){
  var tries=0,max=9;
  function attempt(){
   request('GET','/health',null,function(err,res){
    if(!err&&res&&res.ok){cb(null);return;}
    tries++;
    if(tries>=max){cb(err||new Error('LG medya servisi uyanmadı.'));return;}
    say('LG medya servisi uyandırılıyor… ('+tries+'/'+(max-1)+')');
    setTimeout(attempt,3000);
   },12000);
  }
  attempt();
 }
 function extendMenus(sub,aud){
  if(!session)return;
  for(var i=0;i<session.tracks.length;i++){
   var t=session.tracks[i],label=(t.language==='und'?'Bilinmeyen dil':t.language)+(t.title?' · '+t.title:'')+' ('+t.codec+')';
   if(t.type==='audio')addOption(aud,'LG: '+label,'lg:a:'+t.index);
   if(t.type==='subtitle')addOption(sub,(t.externalVtt?'LG: ':'LG (yalnız bilgi): ')+label,'lg:s:'+t.index);
  }
 }
 function paintSubtitles(){
  if(!cues.length||video.paused){playerOverlay.style.display='none';return;}
  var now=(video.currentTime||0)+offset,chosen=-1;
  for(var i=0;i<cues.length;i++)if(now>=cues[i].start&&now<cues[i].end){chosen=i;break;}
  if(chosen===lastCue)return;
  lastCue=chosen;playerOverlay.textContent=chosen<0?'':cues[chosen].text;
  playerOverlay.style.display=chosen<0?'none':'block';
 }
 function timing(t){
  var p=t.trim().replace(',','.').split(':');if(p.length!==3&&p.length!==2)return NaN;
  var v=0;for(var i=0;i<p.length;i++)v=v*60+Number(p[i]);return v;
 }
 function parseVtt(vtt){
  var lines=String(vtt||'').replace(/\r/g,'').split('\n'),out=[];
  for(var i=0;i<lines.length;i++){
   var m=lines[i].match(/^\s*(\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->\s*(\d{2}:)?\d{2}:\d{2}[.,]\d{3}/);
   if(!m)continue;
   var t=lines[i].split('-->');var st=timing(t[0]),en=timing(t[1].trim().split(/\s+/)[0]),words=[];
   while(i+1<lines.length&&lines[i+1].trim()){words.push(lines[++i]);}
   if(isFinite(st)&&isFinite(en)&&en>st&&words.length)out.push({start:st,end:en,text:words.join('\n').replace(/<[^>]*>/g,'')});
  }
  return out;
 }
 function subtitle(index){
  if(!session)return;
  var t=track('subtitle',index);if(!t)return;
  if(!t.externalVtt){say('Bu altyazı görüntü tabanlı ('+t.codec+'). Metne dönüştürme desteklenmiyor.');return;}
  var x=new XMLHttpRequest();
  cues=[];lastCue=-1;playerOverlay.style.display='none';say('Seçilen altyazı dosyası hazırlanıyor…');
  try{x.open('GET',url+'/subtitle/'+session.token+'/'+index+'.vtt',true);x.timeout=110000;
   x.onreadystatechange=function(){if(x.readyState!==4)return;
     if(x.status!==200){say('Altyazı açılamadı. HTTP '+x.status);return;}
     cues=parseVtt(x.responseText);
     say(cues.length?cues.length+' altyazı satırı yüklendi.':'Altyazı dosyasından kullanılabilir satır okunamadı.');
     paintSubtitles();
   };
   x.onerror=function(){say('Harici altyazı indirilmedi.');};
   x.ontimeout=function(){say('Altyazı hazırlama zaman aşımı.');};
   x.send();
  }catch(e){say(e.message);}
 }
 function track(type,index){if(!session)return null;for(var i=0;i<session.tracks.length;i++)if(session.tracks[i].type===type&&session.tracks[i].index===index)return session.tracks[i];return null;}
 /* MKV subtitle chosen in the TV menu: the TV cannot draw it, so map its subtitle ordinal
    (0 = first subtitle stream) to the service track and render the WebVTT cues in the overlay. */
 var pendingMkvOrdinal=null;
 function applyPendingMkv(){
  if(pendingMkvOrdinal===null||!session)return;
  var ord=pendingMkvOrdinal,n=0,t=null,i;
  pendingMkvOrdinal=null;
  for(i=0;i<session.tracks.length;i++){
   if(session.tracks[i].type!=='subtitle')continue;
   if(n===ord){t=session.tracks[i];break;}
   n++;
  }
  if(!t){say('Bu MKV altyazısı LG medya servisi listesinde bulunamadı.');return;}
  subtitle(t.index);
 }
 function subtitleForMkvOrdinal(ord){
  if(!url||!ctx)return false;
  manual=true;
  pendingMkvOrdinal=ord;
  if(session){applyPendingMkv();return true;}
  say('Altyazı için LG medya servisi taranıyor…');
  scan();
  return true;
 }
 function revert(oldSrc,oldPosition){
  try{
   video.pause();video.src=oldSrc;video.load();
   var once=function(){video.removeEventListener('loadedmetadata',once,false);try{video.currentTime=oldPosition;}catch(e){}video.play();};
   video.addEventListener('loadedmetadata',once,false);
  }catch(e){}
  offset=0;returnButton.style.display='none';
  say('Alternatif ses oynatılamadı. Önceki çalışan oynatıcıya geri dönüldü.');
 }
 function audio(index){
  var t=track('audio',index);
  if(!t||!ctx){say('Ses parçası bulunamadı.');return;}
  var oldSrc=ctx.originalUrl||video.currentSrc||video.src,oldPosition=(video.currentTime||0)+offset;
  returnButton.style.display='inline-block';
  var next=url+'/stream/'+session.token+'/'+index+'?start='+Math.floor(oldPosition);
  var failed=false,ok=false;
  var timer=setTimeout(function(){if(!ok&&!failed){failed=true;video.removeEventListener('error',failure,false);revert(oldSrc,oldPosition);}},16000);
  function failure(){if(failed||ok)return;failed=true;clearTimeout(timer);video.removeEventListener('error',failure,false);revert(oldSrc,oldPosition);}
  var playing=function(){ok=true;clearTimeout(timer);video.removeEventListener('error',failure,false);video.removeEventListener('playing',playing,false);say('Seçili ses: '+(t.language||'Bilinmiyor')+'. Video kopyalama yöntemi etkin.');};
  try{
   video.addEventListener('error',failure,false);
   video.addEventListener('playing',playing,false);
   video.pause();video.src=next;video.load();
   offset=oldPosition;
   var p=video.play();if(p&&p.catch)p.catch(failure);
   say('Alternatif '+(t.language||'ses')+' akışı deneniyor…');
  }catch(e){failure();}
 }
 function autoSelect(){
  if(manual||!session)return;
  var turAudio=null,turSub=null;
  for(var i=0;i<session.tracks.length;i++){
   var t=session.tracks[i];if(!isTr(t))continue;
   if(t.type==='audio'&&!turAudio)turAudio=t;
   if(t.type==='subtitle'&&t.externalVtt&&!turSub)turSub=t;
  }
  if(turAudio){audio(turAudio.index);cues=[];playerOverlay.style.display='none';}
  else if(turSub)subtitle(turSub.index);
 }
 function scanNativeTracks(){
  var aud=document.getElementById('tv-audio'),sub=document.getElementById('tv-subtitles');
  var countA=0,countS=0,tracks=null,i,t,label;
  // webOS 2 may not expose these standard HTMLMediaElement collections.
  // Access defensively and never replace a playing source while scanning.
  try{
   tracks=video.audioTracks;
   if(tracks)for(i=0;i<tracks.length;i++){
    t=tracks[i];label=t.label||t.language||('Ses '+(i+1));
    addOption(aud,'TV: '+label,'native:a:'+i);countA++;
   }
  }catch(e){}
  try{
   tracks=video.textTracks;
   if(tracks)for(i=0;i<tracks.length;i++){
    t=tracks[i];if(t.kind&&t.kind!=='subtitles'&&t.kind!=='captions')continue;
    label=t.label||t.language||('Altyazı '+(i+1));
    addOption(sub,'TV: '+label,'native:s:'+i);countS++;
   }
  }catch(e){}
  return {audio:countA,subtitle:countS};
 }
 function scanHlsManifest(){
  if(!ctx)return;
  var source=String(ctx.originalUrl||video.currentSrc||video.src||'');
  if(!/\.m3u8(?:[?#]|$)/i.test(source)){return;}
  var xhr=new XMLHttpRequest();
  try{
   xhr.open('GET',source,true);xhr.timeout=10000;
   xhr.onreadystatechange=function(){
    if(xhr.readyState!==4)return;
    if(xhr.status<200||xhr.status>=300)return;
    var lines=String(xhr.responseText||'').split(/\r?\n/),aud=document.getElementById('tv-audio'),sub=document.getElementById('tv-subtitles'),foundA=0,foundS=0;
    function attr(line,key){var m=line.match(new RegExp('(?:^|,)'+key+'=(?:"([^"]*)"|([^,]*))','i'));return m?(m[1]||m[2]||''):'';}
    for(var i=0;i<lines.length;i++){
     if(lines[i].indexOf('#EXT-X-MEDIA:')!==0)continue;
     var line=lines[i].slice(13),type=attr(line,'TYPE'),lang=attr(line,'LANGUAGE')||attr(line,'NAME')||'Bilinmeyen',uri=attr(line,'URI');
     if(type==='AUDIO'){addOption(aud,'HLS: '+lang,'hls:info:a:'+foundA++);}
     if(type==='SUBTITLES'){addOption(sub,'HLS: '+lang,'hls:info:s:'+foundS++);}
    }
    if(foundA||foundS)say('HLS manifestinden '+foundA+' ses ve '+foundS+' altyazı tanımı bulundu. TV oynatıcısı akış seçimini desteklemiyorsa bilgi amaçlıdır.');
   };
   xhr.send();
  }catch(e){}
 }
 function scan(){
  if(!ctx){say('Bu bölüm için analiz kaynağı yok. Bölümü yeniden başlatıp tekrar deneyin.');return;}
  if(busy&&Date.now()-busySince<150000){say('Önceki analiz hâlâ sürüyor, birkaç saniye bekleyin.');return;}
  busy=false;
  if(!url){say('LG alternatif medya hizmeti henüz Render üzerinde yapılandırılmadı. Mevcut TV oynatıcı kullanılmaya devam ediyor.');return;}
  scanNativeTracks();scanHlsManifest();
  busy=true;busySince=Date.now();scanButton.disabled=true;var thisScan=++scanSequence;say('LG medya servisi kontrol ediliyor…');
  var retried=false;
  function analyse(){
   say('MKV/MP4 ses ve altyazı parçaları analiz ediliyor…');
   request('POST','/tracks',{serverUrl:ctx.serverUrl,username:ctx.username,password:ctx.password,kind:ctx.kind,id:ctx.id,extension:ctx.extension},function(err,data){
    if(thisScan!==scanSequence)return;
    if(err&&!retried&&/analiz işlemi sürüyor/i.test(String(err.message))){retried=true;setTimeout(function(){if(thisScan===scanSequence)analyse();},4000);return;}
    busy=false;scanButton.disabled=false;
    if(err)pendingMkvOrdinal=null;
    if(err){say('LG medya servisi: '+url+' — '+err.message+'. MKV içi parçalar için üstteki “MKV:” girdileri doğrudan dosya başlığından okunur.');if(window.XIPTVTV&&window.XIPTVTV.refreshTracks)window.XIPTVTV.refreshTracks();return;}
    if(!data||!data.tracks){say('Parça listesi alınamadı.');return;}
    session=data;say(data.tracks.length+' parça bulundu: '+data.tracks.filter(function(t){return t.type==='audio';}).length+' ses, '+data.tracks.filter(function(t){return t.type==='subtitle';}).length+' altyazı. Desteklenmeyen altyazılar yalnızca bilgi amaçlıdır.');
    if(window.XIPTVTV&&window.XIPTVTV.refreshTracks)window.XIPTVTV.refreshTracks();
    applyPendingMkv();
    // Never silently replace a working stream. User chooses a track explicitly.
   },70000);
  }
  wake(function(werr){
   if(thisScan!==scanSequence)return;
   if(werr){busy=false;scanButton.disabled=false;say('LG medya servisine ulaşılamadı ('+werr.message+'). MKV parçaları doğrudan dosya başlığından okunuyor.');if(window.XIPTVTV&&window.XIPTVTV.refreshTracks)window.XIPTVTV.refreshTracks();return;}
   analyse();
  });
 }
 scanButton.onclick=function(){manual=false;scan();};
 returnButton.onclick=function(){if(ctx&&ctx.originalUrl){var pos=(video.currentTime||0)+offset;revert(ctx.originalUrl,pos);say('Önceki çalışan TV oynatıcısı geri açıldı.');}};
 video.addEventListener('timeupdate',paintSubtitles,false);
 video.addEventListener('pause',paintSubtitles,false);
 document.getElementById('tv-subtitles').addEventListener('change',function(){
  if(this.value==='off'){cues=[];lastCue=-1;playerOverlay.style.display='none';return;}
  if(this.value.indexOf('lg:s:')===0){manual=true;subtitle(Number(this.value.split(':')[2]));}
  if(this.value.indexOf('hls:info:')===0){say('HLS parçası bulundu; bu TV oynatıcısında doğrudan geçiş doğrulanmadı.');return;}
  if(this.value.indexOf('native:s:')===0){var n=Number(this.value.split(':')[2]);try{for(var i=0;i<video.textTracks.length;i++)video.textTracks[i].mode=i===n?'showing':'disabled';say('TV altyazısı seçildi.');}catch(e){say('TV altyazı geçişini desteklemiyor.');}}
 },false);
 document.getElementById('tv-audio').addEventListener('change',function(){
  if(this.value.indexOf('lg:a:')===0){manual=true;audio(Number(this.value.split(':')[2]));}
  if(this.value.indexOf('hls:info:')===0){say('HLS ses parçası bulundu; bu TV oynatıcısında doğrudan geçiş doğrulanmadı.');return;}
  if(this.value.indexOf('native:a:')===0){var n=Number(this.value.split(':')[2]);try{for(var i=0;i<video.audioTracks.length;i++)video.audioTracks[i].enabled=i===n;say('TV ses kanalı seçildi.');}catch(e){say('TV ses kanalı geçişini desteklemiyor.');}}
 },false);
 window.XIPTVLGMedia={
  setSource:function(data){scanSequence++;ctx=data;session=null;manual=false;busy=false;started=false;offset=0;cues=[];lastCue=-1;playerOverlay.style.display='none';scanButton.disabled=false;returnButton.style.display='none';summary.textContent='';/* No automatic scan: a second connection to the IPTV account can interrupt the playing stream. Use the scan button. */},
  extendMenus:extendMenus,
  scan:scan,
  subtitleForMkvOrdinal:subtitleForMkvOrdinal
 };
})();