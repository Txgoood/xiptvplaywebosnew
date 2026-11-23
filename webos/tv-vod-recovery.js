/* XIPTV Play TV Player: bounded VOD-only transport recovery for legacy webOS 2. ES5. 
 * This is not codec transcoding. Native/proxy retries cannot decode unsupported codecs.
 * Never attach this state machine to live-TV streams. */
(function(root){
 var video=document.getElementById('video'),current=null,relaySource=null,localRequest=null;
 function closeLocal(){
  var request=localRequest;localRequest=null;
  if(request&&request.cancel){try{request.cancel();}catch(e){}}
 }
 function stop(keepPlayback){
  if(keepPlayback!==true)closeLocal();
  var s=current;current=null;
  if(!s||!video)return;
  if(s.timer)clearTimeout(s.timer);
  if(s.request){s.request.onload=s.request.onerror=s.request.ontimeout=null;s.request.abort();}
  if(relaySource)relaySource.removeEventListener('error',s.onSourceError,false);
  video.removeEventListener('error',s.onError,false);
  video.removeEventListener('timeupdate',s.onProgress,false);
 }
 function notify(s,message){if(typeof s.onStatus==='function')s.onStatus(message);}
 function arm(s){
  if(s.timer)clearTimeout(s.timer);
  s.timer=setTimeout(function(){if(current!==s)return;if(video.paused&&video.readyState>=2){stop(true);return;}fail(s,'Görüntü ilerlemesi 18 saniye içinde algılanmadı',0);},18000);
 }
 function fail(s,reason,code){
  if(current!==s||s.switching||s.played)return;
  var isHls=/\.m3u8(?:[?#]|$)/i.test(s.directUrl);
  if(s.phase==='direct'&&s.allowProxy&&root.XIPTV_PKG==='native'){
   prepareLocal(s);return;
  }
  if(s.phase==='local-hls'||s.phase==='hls-relay'){
   switchSource(s,s.phase+'-url',s.info&&s.info.transport,s.hlsUrl);return;
  }
  if(s.phase==='local-hls-url')closeLocal();
  var needsFallback=s.phase==='direct'||s.phase==='local-hls-url';
  if(needsFallback&&isHls&&s.hlsSource&&s.hlsBase){
   prepareHls(s);
   return;
  }
  if(needsFallback&&s.allowProxy){
   if(isHls){retryMp4(s);return;}
   notify(s,'Film/dizi açılmadı; Render proxy üzerinden bir kez daha deneniyor.');
   switchSource(s,'proxy','proxy-auto',s.proxyPrefix+'?url='+encodeURIComponent(s.directUrl));
   return;
  }
  if(s.phase==='hls-relay-url'){inspectHls(s,reason,code);return;}
  if(s.info){s.info.retrying=false;s.info.terminal=true;s.info.failureReason='VOD '+(code===4?'codec-or-format':'transport');}
  notify(s,'Film/dizi açılamadı ('+(code===4?'LG Hata 4: TV kaynağı açamadı':reason)+'). TV içi oynatma: '+(s.localStatus||'bu pakette TV servisi bulunmuyor')+'. '+(s.hlsStatus||''));
  stop();
 }
 function releaseSource(){
  video.pause();video.removeAttribute('src');
  clearRelaySource();
  video.load();
 }
 function clearRelaySource(){
  if(!relaySource)return;
  if(relaySource.parentNode===video)video.removeChild(relaySource);
  relaySource=null;
 }
 function switchSource(s,phase,transport,url){
  s.switching=true;s.phase=phase;s.observed=false;s.lastTime=0;
  if(s.info){s.info.transport=transport;s.info.retrying=true;if(phase==='mp4')s.info.extension='mp4';}
  try{
   releaseSource();
   if(phase==='hls-relay'||phase==='local-hls'){
    s.hlsUrl=url;
    relaySource=document.createElement('source');
    relaySource.setAttribute('src',url);
    relaySource.setAttribute('type','application/x-mpegurl');
    relaySource.addEventListener('error',s.onSourceError,false);
    video.appendChild(relaySource);
   }else video.src=url;
   video.load();
   s.switching=false;arm(s);
   var p=video.play();if(p&&p.catch)p.catch(function(){if(current===s&&s.phase===phase)fail(s,'Oynatma isteği reddedildi',0);});
  }catch(e){s.switching=false;fail(s,'Alternatif kaynak başlatılamadı',0);}
 }
 function prepareLocal(s){
  clearTimeout(s.timer);s.phase='local-open';s.switching=true;
  if(s.info)s.info.retrying=true;
  var request={cancel:null};
  localRequest=request;
  function unavailable(detail){
   if(current!==s||s.phase!=='local-open')return;
   clearTimeout(s.timer);s.phase='local-hls-url';s.switching=false;
   s.localStatus=detail;fail(s,'TV içi servis açılamadı',0);
  }
  function receive(data){
    if(localRequest!==request||current!==s)return;
    if(!data||!data.returnValue){
     var code=Number(data&&data.errorCode);
     unavailable('TV servisi çağrısı başarısız'+(code?' (kod '+code+')':''));
     return;
    }
    if(s.phase==='local-open'&&/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{40}\/index\.m3u8$/.test(data.url||'')){
     s.localStatus='oynatıcı listeyi istemedi';
     switchSource(s,'local-hls','tv-local-hls',data.url);return;
    }
    if(s.phase!=='local-hls'&&s.phase!=='local-hls-url')return;
    var stages={'list-request':'liste istendi','list-ready':'liste sunuldu','media-request':'medya parçası istendi','media-bytes':'medya verisi geldi'};
    if(stages[data.stage])s.localStatus=stages[data.stage];
    else if(/^error-(list|ts|mp4|aac|vtt|data)-\d{3}$/.test(data.stage||''))s.localStatus=data.stage;
  }
  var serviceUri='luna://com.xiptvplay.tv.native.vod';
  var params={subscribe:true,url:s.directUrl};
  try{
   releaseSource();
   s.timer=setTimeout(function(){unavailable('TV servisi 6 saniye içinde yanıt vermedi');},6000);
   var api=root.webOS&&root.webOS.service;
   if(api&&api.request){
    var subscription=api.request(serviceUri,{method:'open',parameters:params,subscribe:true,onSuccess:receive,onFailure:receive});
    request.cancel=function(){if(subscription&&subscription.cancel)subscription.cancel();};
    if(localRequest!==request)request.cancel();
   }else{
    var Bridge=root.PalmServiceBridge||root.WebOSServiceBridge;
    if(!Bridge){unavailable('webOS servis köprüsü bulunamadı');return;}
    var bridge=new Bridge();
    request.cancel=function(){bridge.onservicecallback=function(){};bridge.cancel();};
    bridge.onservicecallback=function(raw){
     var data;try{data=JSON.parse(raw);}catch(e){data=null;}
     receive(data);
    };
    bridge.call(serviceUri+'/open',JSON.stringify(params));
   }
  }catch(e){unavailable('webOS servis bağlantısı başlatılamadı');}
 }
 function retryMp4(s){
  notify(s,'HLS açılmadı; sağlayıcının MP4 adresi bir kez deneniyor.');
  switchSource(s,'mp4','native-mp4-fallback',s.directUrl.replace(/\.m3u8(?=[?#]|$)/i,'.mp4'));
 }
 function describeRelay(data){
  var status=Number(data.failedStatus),upstream=Number(data.upstreamStatus);
  if(status>=400&&status<=599){
   var item=data.failedKind==='playlist'?'Liste':data.failedKind==='segment'?'Video parçası':'HLS dosyası';
   return item+' HTTP '+status+(upstream>=400&&upstream<=599?' / sağlayıcı HTTP '+upstream:'')+'.';
  }
  if(!data.playlistRequests)return 'LG medya oynatıcısından liste GET isteği gelmedi.';
  if(!data.playlistsServed)return 'Liste isteği tamamlanmadı.';
  if(!data.segmentRequests)return 'Liste gönderildi, video parçası istenmedi.';
  if(!data.segmentsServed)return 'Video parçası isteği tamamlanmadı.';
  return 'Video parçası gönderildi, görüntü başlayamadı.';
 }
 function inspectHls(s,reason,code){
  s.phase='hls-status';s.switching=true;
  clearTimeout(s.timer);s.timer=null;
  function complete(detail){
   if(current!==s||s.phase!=='hls-status')return;
   s.request=null;
   s.hlsStatus=(code?'Uyumlu HLS LG '+code:'Uyumlu HLS: '+reason)+'. '+detail;
   retryMp4(s);
  }
  try{
   releaseSource();
   var xhr=new XMLHttpRequest();s.request=xhr;
   xhr.open('GET',s.hlsBase+s.hlsPath.replace(/index\.m3u8$/,'status'),true);
   xhr.timeout=4500;
   xhr.onload=function(){
    try{
     if(xhr.status===200){complete(describeRelay(JSON.parse(xhr.responseText)));return;}
    }catch(e){}
    complete('Servis tanısı alınamadı.');
   };
   xhr.onerror=xhr.ontimeout=function(){complete('Servis tanısı alınamadı.');};
   xhr.send(null);
  }catch(e){complete('Servis tanısı alınamadı.');}
 }
 function prepareHls(s){
  s.phase='preparing';s.switching=true;
  clearTimeout(s.timer);s.timer=null;
  if(s.info)s.info.retrying=true;
  notify(s,'Film/dizi için LG uyumlu HLS bağlantısı hazırlanıyor…');
  function complete(path,status){
   if(current!==s||s.phase!=='preparing')return;
   s.request=null;
   if(path){
    s.hlsPath=path;
    switchSource(s,'hls-relay','lg-hls-relay',s.hlsBase+path);
   }else{
    s.hlsStatus='Uyumlu HLS bağlantısı hazırlanamadı ('+(status?'HTTP '+status:'ağ veya zaman aşımı')+').';
    retryMp4(s);
   }
  }
  try{
   releaseSource();
   var xhr=new XMLHttpRequest();s.request=xhr;
   xhr.open('POST',s.hlsBase+'/tv-hls',true);
   xhr.setRequestHeader('Content-Type','application/json');xhr.timeout=22000;
   xhr.onload=function(){
    var data;
    try{data=JSON.parse(xhr.responseText);}catch(e){}
    var path=xhr.status===200&&data&&data.success&&data.path;
    complete(typeof path==='string'&&/^\/tv-hls\/[a-f0-9]{48}\/index\.m3u8$/.test(path)?path:null,xhr.status);
   };
   xhr.onerror=xhr.ontimeout=function(){complete(null,0);};
   xhr.send(JSON.stringify(s.hlsSource));
  }catch(e){complete(null,0);}
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
   stop(true);return;
  }
  if(t<s.lastTime-1){s.lastTime=t;return;}
 }
 function start(options){
  stop();
  if(!video||!options||(options.kind!=='movie'&&options.kind!=='series'))return false;
  var ext=String(options.extension||'').toLowerCase();
  var s={phase:options.initialTransport==='proxy'?'proxy':'direct',
   directUrl:String(options.directUrl||''),proxyPrefix:String(options.proxyPrefix||''),
   hlsBase:String(options.hlsBase||'').replace(/\/+$/,''),hlsSource:options.hlsSource,request:null,
   onStatus:options.onStatus,info:options.playbackInfo||null,
   allowProxy:options.initialTransport!=='proxy'&&/^(mp4|mkv|avi|ts|mov|m4v|m3u8)$/.test(ext),
   observed:false,lastTime:0,played:false,switching:false,timer:null};
  if(!s.directUrl)return false;
  s.onError=function(){var code=Number(video.error&&video.error.code)||0;fail(s,'TV medya hatası '+code,code);};
  s.onSourceError=function(event){if(event&&event.target!==relaySource)return;if(s.phase==='hls-relay'||s.phase==='local-hls')fail(s,'LG kaynak öğesini reddetti',Number(video.error&&video.error.code)||0);};
  s.onProgress=function(){progress(s);};
  current=s;
  video.addEventListener('error',s.onError,false);
  video.addEventListener('timeupdate',s.onProgress,false);
  arm(s);return true;
 }
 root.XIPTVVODRecovery={start:start,stop:stop,clearRelaySource:clearRelaySource};
})(window);
