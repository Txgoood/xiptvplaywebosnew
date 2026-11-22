/* XIPTV Play TV Player: bounded VOD-only transport recovery for legacy webOS 2. ES5. 
 * This is not codec transcoding. Native/proxy retries cannot decode unsupported codecs.
 * Never attach this state machine to live-TV streams. */
(function(root){
 var video=document.getElementById('video'),current=null;
 function stop(){
  var s=current;current=null;
  if(!s||!video)return;
  if(s.timer)clearTimeout(s.timer);
  video.removeEventListener('error',s.onError,false);
  video.removeEventListener('timeupdate',s.onProgress,false);
 }
 function notify(s,message){if(typeof s.onStatus==='function')s.onStatus(message);}
 function arm(s){
  if(s.timer)clearTimeout(s.timer);
  s.timer=setTimeout(function(){if(current!==s)return;if(video.paused){stop();return;}fail(s,'Görüntü ilerlemesi 18 saniye içinde algılanmadı',0);},18000);
 }
 function fail(s,reason,code){
  if(current!==s||s.switching||s.played)return;
  if(s.phase==='direct'&&s.allowProxy){
   s.switching=true;s.phase='proxy';s.observed=false;s.lastTime=0;
   if(s.info){s.info.transport='proxy-auto';s.info.retrying=true;}
   notify(s,'Film/dizi açılmadı; Render proxy üzerinden bir kez daha deneniyor. Canlı TV etkilenmez.');
   try{
    // Release the old provider connection before opening the next.
    video.pause();video.removeAttribute('src');video.load();
    video.src=s.proxyPrefix+'?url='+encodeURIComponent(s.directUrl);
    video.load();
    s.switching=false;arm(s);
    var p=video.play();if(p&&p.catch)p.catch(function(){if(current===s)fail(s,'Proxy oynatma reddedildi',0);});
   }catch(e){s.switching=false;fail(s,'Proxy başlatılamadı',0);}
   return;
  }
  if(s.info){s.info.retrying=false;s.info.terminal=true;s.info.failureReason='VOD '+(code===4?'codec-or-format':'transport');}
  notify(s,'Film/dizi açılamadı ('+(code===4?'LG Hata 4: desteklenmeyen biçim/codec':reason)+'). Oynatıcı Ayarları içindeki Uyumlu Oynat veya MP4 8 sn Test seçeneklerini deneyin.');
  stop();
 }
 function progress(s){
  if(current!==s||s.switching)return;
  var t=Number(video.currentTime)||0;
  // 'playing', 'loadeddata' and readyState are not reliable progress signals on webOS 2.
  // Require advancing time updates rather than a single seek/resume jump.
  if(!s.observed){if(t>0){s.observed=true;s.lastTime=t;}return;}
  if(t>s.lastTime+0.35){
   s.played=true;
   if(s.info){s.info.retrying=false;s.info.terminal=false;}
   stop();return;
  }
  if(t<s.lastTime-1){s.lastTime=t;return;}
 }
 function start(options){
  stop();
  if(!video||!options||(options.kind!=='movie'&&options.kind!=='series'))return false;
  var ext=String(options.extension||'').toLowerCase();
  var s={phase:options.initialTransport==='proxy'?'proxy':'direct',
   directUrl:String(options.directUrl||''),proxyPrefix:String(options.proxyPrefix||''),
   onStatus:options.onStatus,info:options.playbackInfo||null,
   allowProxy:options.initialTransport!=='proxy'&&/^(mp4|mkv|avi|ts|mov|m4v)$/.test(ext),
   observed:false,lastTime:0,played:false,switching:false,timer:null};
  if(!s.directUrl)return false;
  s.onError=function(){var code=Number(video.error&&video.error.code)||0;fail(s,'TV medya hatası '+code,code);};
  s.onProgress=function(){progress(s);};
  current=s;
  video.addEventListener('error',s.onError,false);
  video.addEventListener('timeupdate',s.onProgress,false);
  arm(s);return true;
 }
 root.XIPTVVODRecovery={start:start,stop:stop};
})(window);
