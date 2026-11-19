/* XIPTV Play webOS 2: standalone Xtream live-TV prototype, ES5 compatible.
 * No credentials are persisted; all input goes through the user's connected Render API.
 */
(function () {
  var BASE='https://xiptvplay.onrender.com';
  var launcher=document.getElementById('iptv-open');
  var panel=document.getElementById('iptv-panel');
  var login=document.getElementById('iptv-login');
  var browser=document.getElementById('iptv-browser');
  var msg=document.getElementById('iptv-message');
  var categories=document.getElementById('iptv-categories');
  var channels=document.getElementById('iptv-channels');
  var categoryList=[], channelList=[], selectedCategory='all', mode='live';
  var liveChannelOrder=[], lastChannelSwitchAt=0;
   var catalogData=null, lastLive=null, connecting=false, startup=true, lastSeries=null, seriesCache={}, liveRetryCount=0, liveRetryPending=false;
  var PAGE_SIZE=24, currentPage=0, searchTimer=null, sortedCache={}, focusCache=null, categoryCache={};
  var server='',username='',password='';
  var SAVE_KEY='xiptv_webos2_xtream_local_v1';
  var HOME_CACHE_PREFIX='xiptv_webos2_home_preview_v1_';
  var bootAt=new Date().getTime(),verifyAt=0,catalogAt=0,previewReady=false,previewLocked=false;
  var bootLayer=document.getElementById('tv-boot-mask');
  function bootLock(on){previewLocked=on;if(bootLayer)bootLayer.style.display=on?'block':'none';}
  function bootMetric(stage,ms){try{
   var data=JSON.parse(localStorage.getItem('xiptv_webos_boot_timings_v1')||'{}');
   data[stage]=Math.max(0,Math.floor(ms));data.updatedAt=new Date().toISOString();
   localStorage.setItem('xiptv_webos_boot_timings_v1',JSON.stringify(data));
   var label=document.getElementById('tv-boot-diagnostics');
   if(label)label.textContent='Açılış ms · önizleme: '+(data.preview||'—')+' · giriş: '+(data.verify||'—')+' · katalog: '+(data.catalog||'—')+' · çizim: '+(data.render||'—');
  }catch(e){}}
  document.addEventListener('keydown',function(e){if(!previewLocked)return;if(e.preventDefault)e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();},true);
  function cacheKey(){var input=server+'|'+username,hash=0;for(var j=0;j<input.length;j++)hash=((hash<<5)-hash+input.charCodeAt(j))|0;return HOME_CACHE_PREFIX+String(hash);}
  function displayCachedHome(){
    try{
      var cached=JSON.parse(localStorage.getItem(cacheKey())||'null');
      if(!cached||!cached.time||new Date().getTime()-cached.time>48*3600000||!cached.data)return false;
      if(window.XIPTVTVHome&&window.XIPTVTVHome.render)window.XIPTVTVHome.render(cached.data);
      previewReady=true;bootMetric('preview',new Date().getTime()-bootAt);
      return true;
    }catch(e){return false;}
  }
  function trackNewCatalogItems(catalog){
    // Small account-specific snapshot: prevents full 60k-item localStorage writes.
    var key=cacheKey()+'_ids',newKey=cacheKey()+'_new',previous=null;
    try{previous=JSON.parse(localStorage.getItem(key)||'null');}catch(e){}
    var movies=(catalog.vodStreams||[]).slice(0,1800),series=(catalog.seriesList||[]).slice(0,1000);
    var current={movie:[],series:[]},fresh={movie:[],series:[]},i,id,oldMap={};
    for(i=0;i<movies.length;i++)current.movie.push(String(movies[i].stream_id));
    for(i=0;i<series.length;i++)current.series.push(String(series[i].series_id));
    if(previous&&previous.movie&&previous.series){
      for(i=0;i<previous.movie.length;i++)oldMap['m:'+previous.movie[i]]=true;
      for(i=0;i<current.movie.length&&fresh.movie.length<40;i++)if(!oldMap['m:'+current.movie[i]])fresh.movie.push(current.movie[i]);
      oldMap={};for(i=0;i<previous.series.length;i++)oldMap['s:'+previous.series[i]]=true;
      for(i=0;i<current.series.length&&fresh.series.length<40;i++)if(!oldMap['s:'+current.series[i]])fresh.series.push(current.series[i]);
    }else{try{fresh=JSON.parse(localStorage.getItem(newKey)||'null')||fresh;}catch(e){}}
    try{localStorage.setItem(key,JSON.stringify(current));localStorage.setItem(newKey,JSON.stringify(fresh));}catch(e){}
    if(window.XIPTVTVHome)window.XIPTVTVHome.newItemIds=fresh;
  }
  function cacheHome(catalog){
    try{
      if(!window.XIPTVTVHome||!window.XIPTVTVHome.preview)return;
      var preview=window.XIPTVTVHome.preview(catalog);
      localStorage.setItem(cacheKey(),JSON.stringify({time:new Date().getTime(),data:preview}));
    }catch(e){/* Full storage must never block IPTV playback. */}
  }
  function savedCredentials(){try{return JSON.parse(localStorage.getItem(SAVE_KEY)||'null');}catch(e){return null;}}
  function persistCredentials(){try{
    if(document.getElementById('iptv-remember').checked){
      localStorage.setItem(SAVE_KEY,JSON.stringify({server:server,username:username,password:password}));
    }else{localStorage.removeItem(SAVE_KEY);}
  }catch(e){say('TV hafızasına kaydedilemedi: '+e.message);}}
  function hydrate(){
    var c=savedCredentials();if(!c)return false;
    document.getElementById('iptv-server').value=c.server||'';
    document.getElementById('iptv-user').value=c.username||'';
    document.getElementById('iptv-pass').value=c.password||'';
    document.getElementById('iptv-remember').checked=true;
    return !!(c.server&&c.username&&c.password);
  }

  var video=document.getElementById('video');
  function say(t){msg.textContent=t;}
  function safeConnectionError(raw){
    var text=String(raw||'Bilinmeyen bağlantı hatası');
    if(/ERR_INVALID_URL|Failed to parse URL|Invalid URL/i.test(text))return 'Geçersiz bağlantı adresi. Port numarasından önce iki nokta (:) kullanın.';
    // Backend errors can contain full Xtream URLs including passwords. Never show those on TV.
    text=text.replace(/https?:\/\/[^\s]+/gi,'[sunucu adresi gizlendi]');
    if(password)text=text.split(password).join('***');
    if(username)text=text.split(username).join('***');
    return text;
  }

  function show(el){el.style.display='block';}
  function hide(el){el.style.display='none';}
  function clear(el){while(el.firstChild)el.removeChild(el.firstChild);}
  function action(parent,label,cb){
    var b=document.createElement('button');b.type='button';b.appendChild(document.createTextNode(label));b.onclick=cb;parent.appendChild(b);return b;
  }
  function request(route,data,callback){
    // Retry transient Render/backend network failures; never retry invalid credentials.
    var canRetry=route==='/api/iptv/xtream/verify'||route==='/api/iptv/xtream/catalog';
    var attempt=0,maxAttempts=canRetry?3:1,finished=false;
    function submit(){
      if(finished)return;
      attempt++;
      var xhr=new XMLHttpRequest(),resolved=false;
      function done(err,response,retryable){
        if(resolved||finished)return;resolved=true;
        if(err&&retryable&&attempt<maxAttempts){
          say('Bağlantı geçici olarak başarısız. Otomatik yeniden deneniyor ('+(attempt+1)+'/'+maxAttempts+')...');
          setTimeout(submit,attempt*1200);return;
        }
        finished=true;callback(err,response);
      }
      try{
        xhr.open('POST',BASE+route,true);xhr.timeout=45000;
        xhr.setRequestHeader('Content-Type','application/json');
        xhr.onreadystatechange=function(){
          if(xhr.readyState!==4)return;
          var response=null;
          try{response=JSON.parse(xhr.responseText);}catch(err){}
          if(xhr.status<200||xhr.status>=300){
            var reason=response&&response.error||'HTTP '+xhr.status;
            var transient=xhr.status===0||xhr.status===408||xhr.status===429||xhr.status>=500;
            // Authentication errors (401/403) must not be retried.
            done(new Error(reason),null,transient);return;
          }
          if(!response){done(new Error('Sunucu yanıtı okunamadı'),null,true);return;}
          done(null,response,false);
        };
        xhr.onerror=function(){done(new Error('Render sunucusuna bağlantı kurulamadı'),null,true);};
        xhr.ontimeout=function(){done(new Error('Sunucu zaman aşımı'),null,true);};
        xhr.send(JSON.stringify(data));
      }catch(e){done(e,null,true);}
    }
    submit();
  }
  // Some Xtream sources return categories before their live streams on cold start.
  // Retry ONLY the live data in memory; never erase the working film/series catalogue.
  function liveCategoryMatches(data){
    var cats=data.liveCategories||[],streams=data.liveStreams||[],ids={};
    for(var i=0;i<cats.length;i++)ids[String(cats[i].category_id)]=true;
    for(var j=0;j<streams.length;j++)if(ids[String(streams[j].category_id)])return true;
    return !cats.length&&streams.length>0;
  }
  function retryLiveCatalog(){
    if(liveRetryPending||liveRetryCount>=2||!catalogData||connecting)return;
    liveRetryPending=true;liveRetryCount++;
    say('Canlı TV kanalları tamamlanıyor ('+liveRetryCount+'/2)...');
    request('/api/iptv/xtream/catalog',{serverUrl:server,username:username,password:password},function(err,data){
      liveRetryPending=false;
      if(err||!data||!data.liveStreams||!data.liveStreams.length){
        if(liveRetryCount<2)setTimeout(retryLiveCatalog,1500);
        else say('Canlı TV ilk yüklemesi tamamlanamadı. Kanal listesini yeniden yükle seçeneğini kullanabilirsin.');
        return;
      }
      catalogData.liveStreams=data.liveStreams;window.XIPTVGlobalCatalog=catalogData;
      if(data.liveCategories&&data.liveCategories.length)catalogData.liveCategories=data.liveCategories;
      sortedCache={};categoryCache={};focusCache=null;
      if(window.XIPTVTVHome&&window.XIPTVTVHome.render)window.XIPTVTVHome.render(catalogData);
      if(mode==='live'&&panel.style.display!=='none'){
        categoryList=catalogData.liveCategories||[];
        channelList=catalogData.liveStreams||[];
        selectedCategory='all';currentPage=0;renderCategories();
      }
      if(!liveCategoryMatches(catalogData)&&liveRetryCount<2)setTimeout(retryLiveCatalog,1500);
    });
  }
  function chooseMode(next){
    focusCache=null;
    // Always repaint the selected mode: a previously active favorites filter may have emptied it.
    mode=next;selectedCategory='all';currentPage=0;
    if(window.XIPTVCatalogLayout&&window.XIPTVCatalogLayout.clearSeriesPoster)window.XIPTVCatalogLayout.clearSeriesPoster();
    document.getElementById('tv-episodes').style.display='none';
    channels.className=mode==='live'?'tv-live-list':'tv-poster-list';
    var tabNames=['live','movie','series'];
    for(var t=0;t<tabNames.length;t++){
      document.getElementById('tv-tab-'+tabNames[t]).className=mode===tabNames[t]?'active':'';
    }
    if(!catalogData)return;
    categoryList=catalogData[mode==='live'?'liveCategories':mode==='movie'?'vodCategories':'seriesCategories']||[];
    channelList=catalogData[mode==='live'?'liveStreams':mode==='movie'?'vodStreams':'seriesList']||[];
    document.getElementById('tv-now-playing').textContent=mode==='live'?'Canlı TV':mode==='movie'?'Filmler':'Diziler';
    renderCategories();
  }
  var activeEpisodeQueue=[],activeEpisodeIndex=-1,episodeCountdown=null,episodeRemaining=10;
  function cancelEpisodeCountdown(){if(episodeCountdown){clearInterval(episodeCountdown);episodeCountdown=null;}document.getElementById('tv-next-episode').style.display='none';}
  window.XIPTVEpisodeNext={cancel:cancelEpisodeCountdown};
  function startEpisode(entry,index){
    if(!entry||!entry.item)return;
    cancelEpisodeCountdown();
    activeEpisodeIndex=index;
    var ep=entry.item,ext=String(ep.container_extension||'mp4').replace(/[^a-zA-Z0-9]/g,'');
    document.getElementById('tv-episodes').style.display='none';
    document.getElementById('tv-next-episode').style.display='none';
    playStream('series',ep.id,ext,ep.title||'Dizi Bölümü');
  }
  function showSeries(item){
    // One poster can represent several independent provider records.
    // Never discard their episodes: let the viewer choose a source first.
    if(item&&item._xiptvSeriesVariants&&item._xiptvSeriesVariants.length>1){
      var variants=item._xiptvSeriesVariants,popup=document.getElementById('tv-episodes'),list=document.getElementById('tv-episodes-list');
      document.getElementById('tv-episodes-title').textContent=String(item.name||'Dizi')+' — Kaynak Seç';
      clear(list);
      for(var vi=0;vi<variants.length;vi++){(function(source,ordinal){
        action(list,'Kaynak '+ordinal+' · '+String(source.name||item.name||'Dizi')+' · ID '+String(source.series_id),function(){
          popup.style.display='none';
          showSeries(source);
        });
      })(variants[vi],vi+1);}
      popup.style.display='block';
      var first=list.getElementsByTagName('button')[0];if(first)first.focus();
      return;
    }
    if(window.XIPTVCatalogLayout&&window.XIPTVCatalogLayout.rememberSeriesPoster)window.XIPTVCatalogLayout.rememberSeriesPoster();
    var id=item.series_id;
    if(!id){say('Dizi bilgisi eksik');return;}
    window.XIPTVTV.setPlayingItem('series',item);
    say('Dizi bölümleri yükleniyor...');
    lastSeries=item;
    var cached=seriesCache[String(id)];
    function onSeries(err,data){
      if(err){say('Bölümler alınamadı: '+err.message);return;}
      seriesCache[String(id)]=data;
      var metadata=data.info||data;
      var description=metadata.plot||metadata.description||metadata.storyline||'';
      if(description)document.getElementById('tv-media-info-text').textContent=String(item.name||'Dizi')+' — '+String(description);
      var seasons=data.episodes||{}, episodes=[],selector=document.getElementById('tv-season-select'),seasonTools=document.getElementById('tv-season-tools');
      var seasonKeys=Object.keys(seasons).sort(function(a,b){return Number(a)-Number(b);});
      while(selector.firstChild)selector.removeChild(selector.firstChild);
      for(var snIndex=0;snIndex<seasonKeys.length;snIndex++){var sn=seasonKeys[snIndex],option=document.createElement('option');option.value=sn;option.text='Sezon '+sn;selector.appendChild(option);}
      seasonTools.style.display='block';
      for(var sk=0;sk<seasonKeys.length;sk++){
        var season=seasonKeys[sk],group=(seasons[season]||[]).slice(0).sort(function(a,b){return Number(a.episode_num||0)-Number(b.episode_num||0);});
        for(var gi=0;gi<group.length;gi++)episodes.push({season:season,item:group[gi]});
      }
      activeEpisodeQueue=episodes;activeEpisodeIndex=-1;
      if(window.XIPTVTV.registerEpisodeCount)window.XIPTVTV.registerEpisodeCount(id,episodes.length);
      if(!episodes.length){say('Bu dizi için bölüm bulunamadı');return;}
      var popup=document.getElementById('tv-episodes'),list=document.getElementById('tv-episodes-list');
      focusCache=null;
      clear(list);popup.style.display='block';
      document.getElementById('tv-episodes-title').textContent=item.name||'Dizi Bölümleri';
      for(var x=0;x<episodes.length&&x<250;x++){(function(ep){
        action(list,(window.XIPTVTV.isEpisodeWatched&&window.XIPTVTV.isEpisodeWatched(id,ep.item.id)?'✓ İzlenen · ':'')+'Sezon '+ep.season+' • '+String(ep.item.title||ep.item.episode_num||'Bölüm'),function(){
          startEpisode(ep,episodes.indexOf(ep));
        });
      })(episodes[x]);}
      function paintSeason(){var target=document.getElementById('tv-season-episodes');clear(target);var chosen=(seasons[selector.value]||[]).slice(0).sort(function(a,b){return Number(a.episode_num||0)-Number(b.episode_num||0);});for(var z=0;z<chosen.length;z++)(function(ep){action(target,(window.XIPTVTV.isEpisodeWatched&&window.XIPTVTV.isEpisodeWatched(id,ep.id)?'✓ ':'')+String(ep.title||ep.episode_num||'Bölüm'),function(){for(var j=0;j<episodes.length;j++)if(String(episodes[j].item.id)===String(ep.id)){startEpisode(episodes[j],j);return;}});})(chosen[z]);}
      selector.onchange=paintSeason;paintSeason();
      if(window.XIPTVTV.resumeSeriesFromHome){
        window.XIPTVTV.resumeSeriesFromHome=false;
        var map=window.XIPTVTV.getResumeEpisodeMap?window.XIPTVTV.getResumeEpisodeMap():{};
        var wanted=map['series:'+String(id)];
        for(var q=0;q<episodes.length;q++)if(String(episodes[q].item.id)===String(wanted)){
          var ep=episodes[q].item,ext=String(ep.container_extension||'mp4').replace(/[^a-zA-Z0-9]/g,'');
          popup.style.display='none';startEpisode(episodes[q],q);return;
        }
      }
      var firstEpisode=list.getElementsByTagName('button')[0];if(firstEpisode)firstEpisode.focus();
      say(episodes.length+' bölüm bulundu. Bölüm seç.');
    }
    if(cached)onSeries(null,cached);
    else request('/api/iptv/xtream/series_info',{serverUrl:server,username:username,password:password,seriesId:id},onSeries);
  }
  video.addEventListener('ended',function(){
    if(!lastSeries||activeEpisodeIndex<0||activeEpisodeIndex+1>=activeEpisodeQueue.length)return;
    cancelEpisodeCountdown();
    var next=document.getElementById('tv-next-episode'),entry=activeEpisodeQueue[activeEpisodeIndex+1];
    document.getElementById('tv-next-episode-label').textContent='Sıradaki: Sezon '+entry.season+' · '+String(entry.item.title||entry.item.episode_num||'Bölüm');
    episodeRemaining=10;
    var count=document.getElementById('tv-next-episode-countdown');
    if(count)count.textContent='10 saniye sonra otomatik oynatılacak';
    next.style.display='block';document.getElementById('tv-next-episode-play').focus();
    episodeCountdown=setInterval(function(){
      if(next.style.display==='none'){cancelEpisodeCountdown();return;}
      episodeRemaining--;
      if(episodeRemaining<=0){cancelEpisodeCountdown();startEpisode(entry,activeEpisodeIndex+1);return;}
      if(count)count.textContent=episodeRemaining+' saniye sonra otomatik oynatılacak';
    },1000);
  },false);
  document.getElementById('tv-next-episode-play').onclick=function(){cancelEpisodeCountdown();startEpisode(activeEpisodeQueue[activeEpisodeIndex+1],activeEpisodeIndex+1);};
  document.getElementById('tv-next-episode-close').onclick=cancelEpisodeCountdown;
  function playStream(kind,id,ext,name){
    if(kind!=='series'){cancelEpisodeCountdown();activeEpisodeIndex=-1;if(window.XIPTVCatalogLayout&&window.XIPTVCatalogLayout.clearSeriesPoster)window.XIPTVCatalogLayout.clearSeriesPoster();}
    if(id===null||typeof id==='undefined'){say('Yayın kimliği eksik');return;}
    if(window.XIPTVCatalogLayout&&window.XIPTVCatalogLayout.beforePlay)window.XIPTVCatalogLayout.beforePlay();
    var suffix=ext|| (kind==='live'?'m3u8':'mp4');
    var url=server.replace(/\/$/,'')+'/'+kind+'/'+encodeURIComponent(username)+'/'+encodeURIComponent(password)+'/'+encodeURIComponent(id)+'.'+suffix;
    // Expose only non-sensitive playback context to the player diagnostics.
    window.XIPTVPlaybackInfo={kind:kind,extension:suffix,startedAt:new Date().getTime()};
    document.getElementById('tv-now-playing').textContent=String(name||'Video');
    window.XIPTVTV.beforePlay(kind,id,url,name);
    if(window.XIPTVPlayerUI){window.XIPTVPlayerUI.closeMenu();window.XIPTVPlayerUI.update();}
    if(window.XIPTVLGMedia&&window.XIPTVLGMedia.setSource)window.XIPTVLGMedia.setSource(kind==='live'?null:{serverUrl:server,username:username,password:password,kind:kind,id:id,extension:suffix,originalUrl:url});
    if(window.XIPTVAltPlayer&&window.XIPTVAltPlayer.beforeSourceChange)window.XIPTVAltPlayer.beforeSourceChange();
    // Release the previous stream first: many IPTV accounts allow only one connection.
    try{video.pause();video.removeAttribute('src');while(video.firstChild)video.removeChild(video.firstChild);video.load();}catch(e){}
    // A channel may expose only MPEG-TS even when Xtream HLS was requested.
    // Attempt TS once if HLS errors or never reaches playback; leave movies/series untouched.
    var liveTimer=null,liveError=null,livePlaying=null,liveFallback=false,liveActive=true,liveStarted=false;
    if(window.XIPTVLiveCleanup)window.XIPTVLiveCleanup();
    if(window.XIPTVSeriesSourceCleanup)window.XIPTVSeriesSourceCleanup();
    // Some providers label on-demand episodes as HLS although they serve
    // the same episode using MP4. Only try that alternative once, and only
    // when initial HLS playback fails before any frames have played.
    if(kind==='series'&&suffix==='m3u8'){
      (function(){
        var active=true,triedMp4=false,hasPlayed=false,retryTimer=null;
        function clearRetry(){
          active=false;
          if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}
          video.removeEventListener('error',onError,false);
          video.removeEventListener('playing',onPlaying,false);
        }
        function onPlaying(){
          hasPlayed=true;
          if(window.XIPTVPlaybackInfo)window.XIPTVPlaybackInfo.retrying=false;
          clearRetry();
        }
        function onError(){
          if(!active||hasPlayed)return;
          // Do not retry on abort, transport failures or codec decode errors.
          if(!video.error||Number(video.error.code)!==4){clearRetry();return;}
          if(triedMp4){
            if(window.XIPTVPlaybackInfo)window.XIPTVPlaybackInfo.retrying=false;
            clearRetry();return;
          }
          triedMp4=true;
          var info=window.XIPTVPlaybackInfo;
          if(info)info.retrying=true;
          say('Dizi HLS biçiminde açılamadı. Aynı bölüm MP4 olarak bir kez deneniyor...');
          retryTimer=setTimeout(function(){
            if(!active||hasPlayed)return;
            var altUrl=server.replace(/\/$/,'')+'/series/'+encodeURIComponent(username)+'/'+encodeURIComponent(password)+'/'+encodeURIComponent(id)+'.mp4';
            if(info){info.extension='mp4';info.retrying=true;}
            try{
              video.pause();
              video.removeAttribute('src');
              video.load();
              if(window.XIPTVLGMedia&&window.XIPTVLGMedia.setSource){
                window.XIPTVLGMedia.setSource({serverUrl:server,username:username,password:password,kind:'series',id:id,extension:'mp4',originalUrl:altUrl});
              }
              video.src=altUrl;
              video.load();
              var attempt=video.play();
              if(attempt&&attempt.catch)attempt.catch(function(){});
              say('Dizi bölümü MP4 olarak deneniyor...');
            }catch(err){
              clearRetry();
              say('HLS ve MP4 denemesi başarısız. Kaynak biçimi sağlayıcıdan doğrulanmalı.');
            }
          },350);
        }
        video.addEventListener('error',onError,false);
        video.addEventListener('playing',onPlaying,false);
        window.XIPTVSeriesSourceCleanup=clearRetry;
      })();
    }
    function cleanupLive(){
      liveActive=false;
      if(liveTimer){clearTimeout(liveTimer);liveTimer=null;}
      if(liveError)video.removeEventListener('error',liveError,false);
      if(livePlaying)video.removeEventListener('playing',livePlaying,false);
    }
    window.XIPTVLiveCleanup=cleanupLive;
    if(kind==='live'&&suffix==='m3u8'){
      function fallbackTs(){
        if(!liveActive||liveFallback||liveStarted)return;
        liveFallback=true;
        if(liveTimer){clearTimeout(liveTimer);liveTimer=null;}
        var tsUrl=server.replace(/\/$/,'')+'/live/'+encodeURIComponent(username)+'/'+encodeURIComponent(password)+'/'+encodeURIComponent(id)+'.ts';
        try{video.pause();video.src=tsUrl;video.load();var promise=video.play();if(promise&&promise.catch)promise.catch(function(){});say('HLS görüntü vermedi; TS deneniyor: '+String(name||'Kanal'));}catch(e){say('Canlı TV TS hatası: '+e.message);}
      }
      liveError=function(){
        // Only the first HLS startup may trigger fallback; runtime errors must
        // not switch a channel's transport after minutes of playback.
        if(!liveStarted)fallbackTs();
        else say('Canlı TV bağlantısı kesildi. Kanala yeniden girerek tekrar deneyin.');
      };
      livePlaying=function(){
        // A 'playing' event alone is not proof of frames arriving on older webOS.
        // Do not switch sources after playback has actually progressed.
        liveStarted=true;
        if(liveTimer){clearTimeout(liveTimer);liveTimer=null;}
      };
      video.addEventListener('error',liveError,false);
      video.addEventListener('playing',livePlaying,false);
      liveTimer=setTimeout(fallbackTs,9000);
    }
    var started=false;
    function startPlayback(){
      if(started)return;started=true;
      try{
        video.src=url;video.load();video.play();
        say('Oynatılıyor: '+String(name||'Video')+' | '+suffix.toUpperCase()+' • Görüntü/ses desteği yayına bağlıdır.');
      }catch(e){say('Oynatma hatası: '+e.message);}
    }
    // MKV: read the track list BEFORE playback so no second connection competes with the player.
    var deferred=false;
    try{deferred=!!(window.XIPTVMkv&&window.XIPTVMkv.setSource&&window.XIPTVMkv.setSource(kind==='live'?null:{url:url,extension:suffix,kind:kind},startPlayback));}catch(e){deferred=false;}
    if(deferred)say('MKV ses/altyazı listesi okunuyor: '+String(name||'Video')+' …');
    else startPlayback();
  }
  var posterLoadTimer=null;
  function loadPostersNearby(){
    if(channels.className.indexOf('tv-poster-list')<0)return;
    var images=channels.getElementsByTagName('img');
    var min=Math.max(0,channels.scrollTop-260),max=channels.scrollTop+channels.clientHeight+380;
    for(var li=0;li<images.length;li++){
      var img=images[li],src=img.getAttribute('data-iptv-src');
      if(!src)continue;
      var wrapper=img.parentNode&&img.parentNode.parentNode;
      if(!wrapper)continue;
      var top=wrapper.offsetTop;
      if(top>=min&&top<=max){img.removeAttribute('data-iptv-src');if(window.XIPTVPosterCache)window.XIPTVPosterCache.attach(img,src);else img.src=src;}
    }
  }
  channels.addEventListener('scroll',function(){
    if(posterLoadTimer)clearTimeout(posterLoadTimer);
    posterLoadTimer=setTimeout(loadPostersNearby,75);
  },false);
  var renderTicket=0,focusCatalogAfterRender=false;
  function pageAction(label,delta){
    var bar=document.createElement('div');bar.className='tv-page-bar';channels.appendChild(bar);
    var button=action(bar,label,function(){currentPage+=delta;focusCatalogAfterRender=true;renderChannels();channels.scrollTop=0;});
    button.className='tv-page-button';
  }
  function hasTurkishCategories(items){
    for(var ti=0;ti<items.length;ti++){
      var name=String(items[ti].category_name||'').toUpperCase();
      if(/(^|[^A-Z])(TR|TURKISH|TURKIYE|TÜRKİYE|TÜRKÇE)([^A-Z]|$)/.test(name))return true;
    }
    return false;
  }
  function turkishCategory(name){
    return /(^|[^A-Z])(TR|TURKISH|TURKIYE|TÜRKİYE|TÜRKÇE)([^A-Z]|$)/.test(String(name||'').toUpperCase());
  }
  function trFilterApplies(){
    return document.getElementById('tv-tr-only').checked &&
      (mode==='live'||hasTurkishCategories(categoryList));
  }
  function clearAdvancedFilters(){
    document.getElementById('tv-search').value='';
    document.getElementById('tv-filter-year-min').value='';
    document.getElementById('tv-filter-genre').value='';
    document.getElementById('tv-filter-min-rating').value='';
    document.getElementById('tv-search-scope').value='all';
    document.getElementById('tv-favorite-only').checked=false;
  }
  function renderChannels(){
    var ticket=++renderTicket,filterStarted=new Date().getTime();
    focusCache=null;
    clear(channels);
    var count=0;
    var normalize=window.XIPTVGlobalSearch&&window.XIPTVGlobalSearch.normal||function(value){return String(value||'').toLowerCase();};
    var query=normalize(document.getElementById('tv-search').value||''),searchScope=document.getElementById('tv-search-scope').value;
    var sorting=document.getElementById('tv-sort').value;
    var cacheKey=mode+'|'+sorting;
    var list=sortedCache[cacheKey];
    if(!list){list=channelList.slice(0);if(sorting==='old'||sorting==='new')list.sort(function(a,b){var x=Number(a.added||a.release_date||a.year||0),y=Number(b.added||b.release_date||b.year||0);return sorting==='old'?x-y:y-x;});if(sorting==='az')list.sort(function(a,b){return String(a.name||'').localeCompare(String(b.name||''));});if(sorting==='za')list.sort(function(a,b){return String(b.name||'').localeCompare(String(a.name||''));});if(sorting==='rating')list.sort(function(a,b){return Number(b.rating||b.vote_average||0)-Number(a.rating||a.vote_average||0);});sortedCache[cacheKey]=list;}
    var matches=[];
    var totalStreams=channelList.length;
    var yearMin=Number(document.getElementById('tv-filter-year-min').value)||0;
    var genreQuery=String(document.getElementById('tv-filter-genre').value||'').toLowerCase();
    var ratingMin=Number(document.getElementById('tv-filter-min-rating').value)||0;
    var categoryNames={};for(var ca=0;ca<categoryList.length;ca++)categoryNames[String(categoryList[ca].category_id)]=String(categoryList[ca].category_name||'');
    var batch=document.createDocumentFragment();
    if(selectedCategory!=='all'){
      var ck=cacheKey+'|'+selectedCategory;
      if(!categoryCache[ck]){
        var filtered=[];
        for(var ix=0;ix<list.length;ix++)if(String(list[ix].category_id)===selectedCategory)filtered.push(list[ix]);
        categoryCache[ck]=filtered;
      }
      list=categoryCache[ck];
    }
    var i=0;
    function scanChunk(){
      if(ticket!==renderTicket)return;
      var end=Math.min(i+450,list.length);
      for(;i<end;i++){
      var ch=list[i];
      if(selectedCategory!=='all' && String(ch.category_id)!==selectedCategory)continue;
      if(query){var inName=normalize(ch.name||ch.title||'').indexOf(query)>=0;var inCategory=normalize(categoryNames[String(ch.category_id)]||'').indexOf(query)>=0;if(searchScope==='name'&&!inName||searchScope==='category'&&!inCategory||searchScope==='all'&&!inName&&!inCategory)continue;}
      if(!window.XIPTVTV.filterFavorite(mode,ch))continue;
      if(window.XIPTVTV.canShowItem&&!window.XIPTVTV.canShowItem(mode,ch))continue;
      var catLabel=categoryNames[String(ch.category_id)]||'';
      if(mode!=='live'){
        var year=Number(ch.year||String(ch.release_date||'').slice(0,4))||0;
        if(yearMin&&(!year||year<yearMin))continue;
        var rating=Number(ch.rating||ch.vote_average||0);if(ratingMin&&rating<ratingMin)continue;
        if(genreQuery&&String(ch.genre||ch.genre_names||catLabel).toLowerCase().indexOf(genreQuery)<0)continue;
      }
      if(trFilterApplies() && !turkishCategory(catLabel))continue;
      if(document.getElementById('tv-hide-adult').checked && /^(XXX|18\+|ADULT|🔞|❤)/i.test(catLabel))continue;
      matches.push(ch);
      }
      if(i<list.length){setTimeout(scanChunk,0);return;}
      finishRender();
    }
    function finishRender(){
    if(ticket!==renderTicket)return;
    if(window.XIPTVPerformance)window.XIPTVPerformance.measure('Katalog filtreleme',new Date().getTime()-filterStarted);
    // Collapse duplicate series posters conservatively: same canonical name AND year.
    // Provider entries remain untouched so each source retains its own seasons and episodes.
    if(mode==='series'&&matches.length>1){
      var unique=[],bySignature={};
      for(var di=0;di<matches.length;di++){
        var source=matches[di],title=String(source.name||source.title||'').replace(/^\s+|\s+$/g,'');
        var year=String(source.year||'').replace(/[^0-9]/g,'');
        if(!year){var y=title.match(/(?:\(|\[)(19[0-9]{2}|20[0-9]{2})(?:\)|\])/);if(y)year=y[1];}
        if(!year){var date=String(source.release_date||'');var m=date.match(/^(19[0-9]{2}|20[0-9]{2})/);if(m)year=m[1];}
        // Without a release year, preserve entries separately to avoid merging remakes.
        var signature=year?title.toLowerCase().replace(/\s*(?:\(|\[)(?:19|20)[0-9]{2}(?:\)|\])\s*/g,' ').replace(/[^a-z0-9\u00c0-\u024f\u0400-\u04ff]+/g,' ').replace(/^\s+|\s+$/g,'')+'|'+year:'';
        if(!signature){unique.push(source);continue;}
        var previous=bySignature[signature];
        if(!previous){
          var clone={};for(var prop in source)if(Object.prototype.hasOwnProperty.call(source,prop))clone[prop]=source[prop];
          clone._xiptvSeriesVariants=[source];bySignature[signature]=clone;unique.push(clone);
        }else if(String(previous.series_id)!==String(source.series_id)){
          var exists=false;for(var gi=0;gi<previous._xiptvSeriesVariants.length;gi++)if(String(previous._xiptvSeriesVariants[gi].series_id)===String(source.series_id))exists=true;
          if(!exists)previous._xiptvSeriesVariants.push(source);
        }
      }
      matches=unique;
    }
    // Preserve the category/filter/sort order for fullscreen channel zapping.
    // Only a live list becomes a channel-change source; films and series never do.
    if(mode==='live')liveChannelOrder=matches.slice(0);
    var totalPages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));
    if(currentPage>=totalPages)currentPage=totalPages-1;
    if(currentPage>0)pageAction('◀ Önceki sayfa',-1);
    var first=currentPage*PAGE_SIZE,last=Math.min(first+PAGE_SIZE,matches.length);
    for(var j=first;j<last;j++){
      var ch=matches[j];
      (function(item){
        var line=action(channels,(count+1)+'. '+String(item.name||item.title||'İsimsiz'),function(){
          if(mode==='live')playChannel(item);
          else if(mode==='movie'){window.XIPTVTV.setPlayingItem('movie',item);playStream('movie',item.stream_id,String(item.container_extension||'mp4').replace(/[^a-zA-Z0-9]/g,''),item.name);}
          else showSeries(item);
        });
        if(mode!=='live'){
          var title=String(item.name||item.title||'İsimsiz');
          var picture=String(item.stream_icon||item.cover||item.cover_big||'');
          line.textContent='';
          if(mode==='series'){
            // Xtream providers often omit stream_icon for series; prefer the real series cover.
            var sources=[],fields=[item.cover,item.cover_big,item.stream_icon,item.movie_image,item.poster],seen={};
            for(var pi=0;pi<fields.length;pi++){
              var src=String(fields[pi]||'').replace(/^\s+|\s+$/g,'');
              if(src.indexOf('//')===0)src='https:'+src;
              if(/^\/[^\/]/.test(src))src='https://image.tmdb.org/t/p/w500'+src;
              if(!/^https?:\/\//i.test(src)||seen[src])continue;
              seen[src]=true;sources.push(src);
            }
            var fallback=document.createElement('span');fallback.className='tv-poster-placeholder';fallback.textContent='DİZİ';line.appendChild(fallback);
            if(sources.length){var image=document.createElement('img'),sourceIndex=0;
              image.alt='';image.style.display='none';
              image.onload=function(){fallback.style.display='none';image.style.display='block';};
              image.onerror=function(){sourceIndex++;if(sourceIndex<sources.length){if(window.XIPTVPosterCache)window.XIPTVPosterCache.attach(image,sources[sourceIndex]);else image.src=sources[sourceIndex];}else{image.style.display='none';fallback.style.display='block';if(window.XIPTVMetadata){image.removeAttribute('src');window.XIPTVMetadata.usePoster(image,item,'series');}}};
              image.setAttribute('loading','lazy');image.setAttribute('data-iptv-src',sources[0]);line.appendChild(image);
            }
          }else if(/^https?:\/\//i.test(picture)){
            var img=document.createElement('img');img.alt='';img.setAttribute('loading','lazy');img.setAttribute('data-iptv-src',picture);
            img.alt='';img.loading='lazy';
            img.onerror=function(){this.style.display='none';if(window.XIPTVMetadata){this.removeAttribute('src');window.XIPTVMetadata.usePoster(this,item,'movie');}};
            line.appendChild(img);
          }else{
            var placeholder=document.createElement('span');
            placeholder.className='tv-poster-placeholder';
            placeholder.textContent='FİLM';
            line.appendChild(placeholder);
            if(window.XIPTVMetadata){var recoveredImage=document.createElement('img');recoveredImage.alt='';recoveredImage.style.display='none';recoveredImage.onload=function(){placeholder.style.display='none';recoveredImage.style.display='block';};line.appendChild(recoveredImage);window.XIPTVMetadata.usePoster(recoveredImage,item,'movie');}
          }
          var caption=document.createElement('span');caption.className='tv-card-title';
          caption.textContent=title;line.appendChild(caption);
          line.title=title;
        }
        window.XIPTVTV.decorateItem(line,mode,item);
      })(ch);count++;
      if(channels.lastChild)batch.appendChild(channels.lastChild);
    }
    channels.appendChild(batch);
    if(mode!=='live')loadPostersNearby();
    if(currentPage+1<totalPages)pageAction('Sonraki sayfa ▶ ('+(currentPage+2)+'/'+totalPages+')',1);
    if(!matches.length){
      if(mode==='live' && !document.getElementById('tv-search').value && !document.getElementById('tv-favorite-only').checked && liveRetryCount<2) setTimeout(retryLiveCatalog,700);
      var empty=document.createElement('div');empty.className='tv-empty-results';
      empty.textContent=totalStreams===0?'Canlı TV kanal verisi sunucudan boş geldi. Katalog yeniden yüklenmeli.':'Bu kategoride eşleşen kanal bulunamadı ('+totalStreams+' kayıt yüklendi).';
      channels.appendChild(empty);
      if(totalStreams>0)action(channels,'Arama ve gelişmiş filtreleri temizle',function(){clearAdvancedFilters();selectedCategory='all';currentPage=0;renderCategories();});
      if(mode==='live')action(channels,'Kanal listesini yeniden yükle',function(){document.getElementById('iptv-connect').click();});
    }
    if(focusCatalogAfterRender){focusCatalogAfterRender=false;if(window.XIPTVCatalogNavigation)window.XIPTVCatalogNavigation.focus(channels,window.XIPTVCatalogNavigation.first(channels));}
    say(matches.length+' içerik bulundu; '+totalStreams+' kayıt yüklü. Sayfa '+(currentPage+1)+'/'+totalPages+'.');
    }
    scanChunk();
  }
  function renderCategories(){
    focusCache=null;
    clear(categories);
    action(categories,'Tümü',function(){selectedCategory='all';currentPage=0;if(window.XIPTVCatalogLayout)window.XIPTVCatalogLayout.sync(mode,selectedCategory,categoryList);renderChannels();});
    for(var i=0;i<categoryList.length;i++){
      (function(c){var label=String(c.category_name||'Kategori');if(trFilterApplies()&&!turkishCategory(label))return;if(document.getElementById('tv-hide-adult').checked&&/^(XXX|18\\+|ADULT|🔞|❤)/i.test(label))return;action(categories,label,function(){selectedCategory=String(c.category_id);currentPage=0;if(window.XIPTVCatalogLayout)window.XIPTVCatalogLayout.sync(mode,selectedCategory,categoryList);renderChannels();});})(categoryList[i]);
    }
    if(window.XIPTVCatalogLayout&&window.XIPTVCatalogLayout.sync)window.XIPTVCatalogLayout.sync(mode,selectedCategory,categoryList);
    if(mode!=='live'&&document.getElementById('tv-tr-only').checked&&!hasTurkishCategories(categoryList)){
      var hint=document.createElement('div');hint.className='tv-category-notice';
      hint.textContent='Yeni playlistte TR etiketli kategori bulunamadı. Film ve dizileri gizlememek için TR filtresi bu bölümde uygulanmadı.';
      categories.appendChild(hint);
    }
    renderChannels();
  }
  var previousChannel=null,numberBuffer='',numberTimer=null;
  var channelPanel=document.getElementById('tv-channel-panel');
  function toggleChannelPanel(){
    if(!lastLive){say('Önce bir canlı kanal aç.');return;}
    if(channelPanel.style.display!=='none'){channelPanel.style.display='none';return;}
    clear(channelPanel);var heading=document.createElement('strong');heading.textContent='Canlı Kanallar';channelPanel.appendChild(heading);
    var first=Math.max(0,liveChannelOrder.length>26?liveChannelOrder.indexOf(lastLive)-9:0);
    if(first<0)first=0;
    var last=Math.min(liveChannelOrder.length,first+26),selected=null;
    for(var ci=first;ci<last;ci++)(function(item,number){var btn=document.createElement('button');btn.type='button';btn.className='tv-channel-choice';btn.textContent=number+'. '+String(item.name||'Kanal');btn.onclick=function(){channelPanel.style.display='none';playChannel(item);};channelPanel.appendChild(btn);if(lastLive&&String(lastLive.stream_id)===String(item.stream_id))selected=btn;})(liveChannelOrder[ci],ci+1);
    channelPanel.style.display='block';if(selected)selected.focus();else{var buttons=channelPanel.getElementsByTagName('button');if(buttons.length)buttons[0].focus();}
  }
  var channelButton=document.getElementById('tv-player-channels');if(channelButton)channelButton.onclick=toggleChannelPanel;
  function channelNotice(message){if(window.XIPTVPlayerUI&&window.XIPTVPlayerUI.notice)window.XIPTVPlayerUI.notice(message,'info');}
  function chooseChannelNumber(n){if(!lastLive||!liveChannelOrder.length||n<1||n>liveChannelOrder.length)return;playChannel(liveChannelOrder[n-1]);}
  function changeLiveChannel(step){
    if(!lastLive||!liveChannelOrder.length)return;
    var now=new Date().getTime();
    if(now-lastChannelSwitchAt<650)return; // Do not open multiple streams on held keys.
    var index=-1;
    for(var i=0;i<liveChannelOrder.length;i++){
      if(String(liveChannelOrder[i].stream_id)===String(lastLive.stream_id)){index=i;break;}
    }
    var next=index<0?(step>0?0:liveChannelOrder.length-1):(index+step+liveChannelOrder.length)%liveChannelOrder.length;
    if(index===next)return;
    lastChannelSwitchAt=now;
    playChannel(liveChannelOrder[next]);
  }
  function playChannel(item){
    if(window.XIPTVTV.canShowItem&&!window.XIPTVTV.canShowItem('live',item)){say('Bu kanal için ebeveyn onayı gerekiyor.');return;}
    if(lastLive&&String(lastLive.stream_id)!==String(item.stream_id))previousChannel=lastLive;
    lastLive=item;
    channelNotice('Kanal: '+String(item.name||'Canlı TV'));
    window.XIPTVTV.setPlayingItem('live',item);
    playStream('live',item.stream_id,'m3u8',item.name);
  }
  document.getElementById('tv-try-ts').onclick=function(){
    if(!lastLive){say('Önce bir canlı kanal seç.');return;}
    playStream('live',lastLive.stream_id,'ts',lastLive.name);
    say('Alternatif MPEG-TS akışı deneniyor. Bu biçim de desteklenmeyebilir.');
  };
  document.getElementById('tv-try-ts-inplayer').onclick=function(){document.getElementById('tv-try-ts').click();};
  document.getElementById('tv-try-hls-inplayer').onclick=function(){document.getElementById('tv-try-hls').click();};
  document.getElementById('tv-try-hls').onclick=function(){
    if(!lastLive){say('Önce bir canlı kanal seç.');return;}
    playStream('live',lastLive.stream_id,'m3u8',lastLive.name);
  };
  document.getElementById('tv-search-scope').onchange=function(){currentPage=0;renderChannels();};
  document.getElementById('tv-advanced-search').onclick=function(){var x=document.getElementById('tv-search-scope'),advanced=document.getElementById('tv-advanced-filters'),show=x.style.display==='none';x.style.display=show?'inline-block':'none';advanced.style.display=show?'block':'none';};
  var filterIds=['tv-filter-year-min','tv-filter-genre','tv-filter-min-rating'];for(var fi=0;fi<filterIds.length;fi++){document.getElementById(filterIds[fi]).onkeyup=function(){clearTimeout(searchTimer);searchTimer=setTimeout(function(){currentPage=0;renderChannels();},250);};document.getElementById(filterIds[fi]).onchange=function(){currentPage=0;renderChannels();};}
  document.getElementById('tv-search').onkeyup=function(){clearTimeout(searchTimer);searchTimer=setTimeout(function(){currentPage=0;renderChannels();},250);};
  document.getElementById('tv-favorite-type').onchange=function(){document.getElementById('tv-favorite-only').checked=true;chooseMode(this.value);};
  document.getElementById('tv-sort').onchange=function(){currentPage=0;renderChannels();};
  document.getElementById('tv-tr-only').onchange=function(){currentPage=0;selectedCategory='all';renderCategories();};
  document.getElementById('tv-hide-adult').onchange=function(){currentPage=0;selectedCategory='all';renderCategories();};
  window.XIPTVTV.refresh=renderChannels;
  window.XIPTVTV.refreshCategories=renderCategories;
  document.getElementById('tv-tab-live').onclick=function(){chooseMode('live');};
  document.getElementById('tv-tab-movie').onclick=function(){chooseMode('movie');};
  document.getElementById('tv-tab-series').onclick=function(){chooseMode('series');};
  document.getElementById('tv-episodes-close').onclick=function(){document.getElementById('tv-episodes').style.display='none';};
  var fullBtn=document.getElementById('tv-fullscreen');
  var aspectBtn=document.getElementById('tv-aspect');
  function hasClass(name){return (' '+document.body.className+' ').indexOf(' '+name+' ')>=0;}
  function setClass(name,enabled){
    var classes=(' '+document.body.className+' ').replace(' '+name+' ',' ');
    document.body.className=classes.replace(/^\s+|\s+$/g,'')+(enabled?' '+name:'');
  }
  function updatePlayerButtons(){
    fullBtn.textContent=hasClass('tv-fullscreen')?'Tam Ekrandan Çık':'Tam Ekran';
    aspectBtn.textContent=hasClass('tv-fill')?'Orijinal Oran':'Ekrana Doldur';
  }
  fullBtn.onclick=function(){if(hasClass('tv-fullscreen')&&window.XIPTVCatalogLayout&&window.XIPTVCatalogLayout.exitPlayer)window.XIPTVCatalogLayout.exitPlayer();else setClass('tv-fullscreen',!hasClass('tv-fullscreen'));updatePlayerButtons();};
  aspectBtn.onclick=function(){setClass('tv-fill',!hasClass('tv-fill'));updatePlayerButtons();};
  // Catch D-pad before the legacy diagnostic menu handler; traverse visible controls.
  document.addEventListener('keydown',function(e){
    if(document.getElementById('tv-home').style.display!=='none')return;
    if(document.getElementById('iptv-keyboard').style.display!=='none')return;
    var key=e.keyCode||e.which;
    // Handle custom selector before fullscreen channel-zapping or focus navigation.
    if(window.XIPTVPlayerUI&&window.XIPTVPlayerUI.menuOpen()&&window.XIPTVPlayerUI.onKey(key)){
      e.preventDefault();e.stopImmediatePropagation();return;
    }
    // Green remote key opens or closes the fullscreen channel drawer.
    if(key===404&&hasClass('tv-fullscreen')&&lastLive){toggleChannelPanel();e.preventDefault();e.stopImmediatePropagation();return;}
    if(channelPanel.style.display!=='none'){
      if(key===461||key===27){channelPanel.style.display='none';e.preventDefault();e.stopImmediatePropagation();return;}
      var channelButtons=channelPanel.getElementsByTagName('button'),currentIndex=-1;
      for(var cb=0;cb<channelButtons.length;cb++)if(channelButtons[cb]===document.activeElement)currentIndex=cb;
      if(key===38||key===40){if(channelButtons.length)channelButtons[(currentIndex+(key===38?-1:1)+channelButtons.length)%channelButtons.length].focus();e.preventDefault();e.stopImmediatePropagation();return;}
      if(key===13){if(currentIndex>=0)channelButtons[currentIndex].click();e.preventDefault();e.stopImmediatePropagation();return;}
    }
    // Yellow remote key returns to the previous channel. LG firmware may reserve it.
    if(key===405&&hasClass('tv-fullscreen')&&previousChannel){playChannel(previousChannel);e.preventDefault();e.stopImmediatePropagation();return;}
    // Numeric remote keys select the 1-based visible channel order after 1.2s.
    if(hasClass('tv-fullscreen')&&lastLive&&((key>=48&&key<=57)||(key>=96&&key<=105))){
      var digit=key>=96?key-96:key-48;numberBuffer=(numberBuffer+String(digit)).slice(-4);
      channelNotice('Kanal numarası: '+numberBuffer);
      if(numberTimer)clearTimeout(numberTimer);
      numberTimer=setTimeout(function(){var n=Number(numberBuffer);numberBuffer='';chooseChannelNumber(n);},1200);
      e.preventDefault();e.stopImmediatePropagation();return;
    }
    // Blue remote key: toggle fullscreen without changing the selected channel.
    // Keep OK, Back and the other color keys on their existing paths.
    if(key===406 && (video.currentSrc||video.getAttribute('src'))){
      if(hasClass('tv-fullscreen')&&window.XIPTVCatalogLayout&&window.XIPTVCatalogLayout.exitPlayer)window.XIPTVCatalogLayout.exitPlayer();
      else setClass('tv-fullscreen',!hasClass('tv-fullscreen'));
      updatePlayerButtons();
      e.preventDefault();e.stopImmediatePropagation();return;
    }
    // LG webOS 2 may report P+/P- as 33/34 or 427/428. On some firmware
    // these keys are reserved by the OS; D-pad up/down is the fallback.
    if(hasClass('tv-fullscreen')&&lastLive&&liveChannelOrder.length&&
       (key===33||key===34||key===427||key===428||key===38||key===40)){
      changeLiveChannel((key===33||key===427||key===38)?1:-1);
      e.preventDefault();e.stopImmediatePropagation();return;
    }
    if(hasClass('tv-fullscreen')&&key===13){var controls=document.getElementById('tv-player-controls');if(controls&&controls.style.opacity==='0'){if(window.XIPTVPlayerUI&&window.XIPTVPlayerUI.show)window.XIPTVPlayerUI.show();document.getElementById('tv-player-back').focus();e.preventDefault();e.stopImmediatePropagation();return;}}
    if(key!==37&&key!==38&&key!==39&&key!==40&&key!==13&&key!==461&&key!==27)return;
    if((key===461||key===27)&&hasClass('tv-fullscreen')){if(window.XIPTVCatalogLayout&&window.XIPTVCatalogLayout.exitPlayer)window.XIPTVCatalogLayout.exitPlayer();else setClass('tv-fullscreen',false);updatePlayerButtons();e.preventDefault();e.stopImmediatePropagation();return;}
    // Navigate catalogue cards by their rendered rows, skipping favorite/child badges.
    var activeCard=document.activeElement,nav=window.XIPTVCatalogNavigation;
    var side=document.getElementById('stitch-side');
    if(nav&&!hasClass('tv-fullscreen')&&(key===37||key===38||key===39||key===40)&&
       document.getElementById('tv-episodes').style.display==='none'&&
       (channels.contains(activeCard)||(key===40&&activeCard&&
        (activeCard.parentNode===side||activeCard.id==='tv-catalog-back'||activeCard.id==='tv-category-open')))){
      var target=channels.contains(activeCard)?nav.target(channels,activeCard,key):nav.first(channels);
      if(target)nav.focus(channels,target);
      else if(key===38){var selected=side.querySelector('button.selected');if(selected)selected.focus();}
      e.preventDefault();e.stopImmediatePropagation();return;
    }
    var list=focusCache,i,el;
    if(!list){list=[];
      var nodes=document.getElementsByTagName('button');
      for(i=0;i<nodes.length;i++){el=nodes[i];if(el.offsetWidth>0&&el.offsetHeight>0)list.push(el);}
      var inputs=document.getElementsByTagName('input');
      for(i=0;i<inputs.length;i++){el=inputs[i];if(el.offsetWidth>0&&el.offsetHeight>0)list.push(el);}
      focusCache=list;
    }
    var active=document.activeElement,idx=-1;
    for(i=0;i<list.length;i++)if(list[i]===active){idx=i;break;}
    if((key===461||key===27)&&document.getElementById('tv-next-episode').style.display!=='none'){cancelEpisodeCountdown();e.preventDefault();e.stopImmediatePropagation();return;}
    if((key===461||key===27)&&document.getElementById('tv-episodes').style.display!=='none'){document.getElementById('tv-episodes').style.display='none';e.preventDefault();e.stopImmediatePropagation();return;}
    if((key===461||key===27)&&window.XIPTVCatalogLayout&&window.XIPTVCatalogLayout.goBack&&window.XIPTVCatalogLayout.goBack()){e.preventDefault();e.stopImmediatePropagation();return;}
    if((key===461||key===27)&&panel.style.display!=='none'){hide(panel);document.body.className='';document.getElementById('tv-home').style.display='block';updatePlayerButtons();document.getElementById('tv-nav-home').focus();e.preventDefault();e.stopImmediatePropagation();return;}
    if(key===13 && active && active.tagName==='BUTTON'){
      active.click();e.preventDefault();e.stopImmediatePropagation();return;
    }
    if(key===37||key===38||key===39||key===40){
      // Keep text-field arrow navigation native while typing.
      if(active && active.tagName==='INPUT')return;
      if(list.length){
        var next=list[(idx+(key===37||key===38?-1:1)+list.length)%list.length];
        if(next.offsetWidth&&next.offsetHeight){next.focus();
          if(next.parentNode===channels||next.parentNode&&next.parentNode.parentNode===channels){var top=next.offsetTop;if(top<channels.scrollTop)channels.scrollTop=top;else if(top+next.offsetHeight>channels.scrollTop+channels.clientHeight)channels.scrollTop=top+next.offsetHeight-channels.clientHeight;}}
        else focusCache=null;
      }
      e.preventDefault();e.stopImmediatePropagation();
    }
  },true);
  window.XIPTVTV.openSection=function(next){window.XIPTVTV.startMode=next;launcher.click();};
  window.XIPTVTV.openItem=function(kind,item){
    if(window.XIPTVTV.canShowItem&&!window.XIPTVTV.canShowItem(kind,item)){say('Bu içerik için ebeveyn onayı gerekiyor.');return;}
    window.XIPTVTV.setPlayingItem(kind,item);
    if(kind==='series')showSeries(item);
    else if(kind==='movie')playStream('movie',item.stream_id,String(item.container_extension||'mp4').replace(/[^a-zA-Z0-9]/g,''),item.name);
    else playChannel(item);
  };
  window.XIPTVTV.showSeriesEpisodes=function(){if(lastSeries)showSeries(lastSeries);};
  launcher.onclick=function(){
    focusCache=null;
    // Reuse the active catalogue when changing sections from Stitch navigation.
    // Do not reset to the login/transition screen for every menu selection.
    if((' '+document.body.className+' ').indexOf(' tv-catalog ')<0){
      document.body.className='tv-mode';
    }
    show(panel);
    if(catalogData){
      hide(login);
      show(browser);
      chooseMode(window.XIPTVTV.startMode||mode||'live');
      return;
    }
    show(login);hide(browser);
    if(hydrate()){say('Kayıtlı Xtream bağlantısı bulundu. Otomatik bağlanılıyor...');document.getElementById('iptv-connect').click();}
    else{document.getElementById('iptv-server').focus();}
  };
  // Profile menu entry: reopen existing Xtream login without losing stored data.
  window.XIPTVTV.openConnectionSettings=function(){
    if(window.XIPTVTV.isChildProfile&&window.XIPTVTV.isChildProfile()){
      var warning=document.getElementById('tv-profile-message');
      if(warning)warning.textContent='Playlist ayarlarını yetişkin profili yönetebilir.';
      return false;
    }
    var profilePanel=document.getElementById('tv-profile-panel');
    if(profilePanel)profilePanel.style.display='none';
    focusCache=null;
    show(panel);show(login);hide(browser);
    document.body.className='tv-mode tv-catalog';
    document.getElementById('tv-home').style.display='none';
    say('Playlist bağlantısını buradan değiştirebilirsin. Kayıtlı Girişi Sil düğmesine basmadıkça mevcut bilgiler silinmez.');
    document.getElementById('iptv-server').focus();
    return true;
  };
  document.getElementById('iptv-forget').onclick=function(){
    try{localStorage.removeItem(SAVE_KEY);}catch(e){}
    document.getElementById('iptv-server').value='';
    document.getElementById('iptv-user').value='';
    document.getElementById('iptv-pass').value='';
    document.getElementById('iptv-remember').checked=false;
    server='';username='';password='';categoryList=[];channelList=[];catalogData=null;sortedCache={};categoryCache={};focusCache=null;
    hide(browser);show(login);say('Bu TV’deki kayıtlı giriş bilgileri temizlendi.');
  };
  document.getElementById('iptv-hide').onclick=function(){hide(panel);document.body.className='';updatePlayerButtons();launcher.focus();};
  document.getElementById('iptv-connect').onclick=function(){
    var parsed=window.XIPTVPlaylistInput&&window.XIPTVPlaylistInput.parse(
      document.getElementById('iptv-server').value,
      document.getElementById('iptv-user').value,
      document.getElementById('iptv-pass').value);
    if(!parsed||parsed.error){say(parsed?parsed.error:'Playlist adresi okunamadı.');show(login);hide(browser);return;}
    server=parsed.server;username=parsed.username;password=parsed.password;
    document.getElementById('iptv-server').value=server;
    document.getElementById('iptv-user').value=username;
    document.getElementById('iptv-pass').value=password;
    if(connecting)return;
    connecting=true;verifyAt=new Date().getTime();
    if(server.indexOf('http://')!==0 && server.indexOf('https://')!==0)server='http://'+server;
    say('Xtream bağlantısı doğrulanıyor...');
    request('/api/iptv/xtream/verify',{serverUrl:server,username:username,password:password},function(err,data){
      if(err||!data.success){connecting=false;bootLock(false);previewReady=false;show(panel);show(login);hide(browser);document.getElementById('tv-home').style.display='none';say('Doğrulama başarısız: '+safeConnectionError(err?err.message:data.error||'Hesap reddedildi'));return;}
      bootMetric('verify',new Date().getTime()-verifyAt);bootLock(false);
      server=data.effectiveServerUrl||server;
      persistCredentials();
      // A previously verified account can immediately browse a small local home preview,
      // while the complete catalogue is refreshed from the provider.
      if(startup&&!previewReady&&displayCachedHome()){startup=false;hide(panel);document.body.className='';document.getElementById('tv-home').style.display='block';document.getElementById('tv-nav-home').focus();}
      if(previewReady){startup=false;hide(panel);document.getElementById('tv-home').style.display='block';}
      say('Bağlantı doğrulandı; katalog güncelleniyor...');
      catalogAt=new Date().getTime();
      request('/api/iptv/xtream/catalog',{serverUrl:server,username:username,password:password},function(error,catalog){
        connecting=false;
        if(error){if(!previewReady){show(panel);show(login);hide(browser);document.getElementById('tv-home').style.display='none';}say('Katalog güncellenemedi: '+safeConnectionError(error.message));return;}
        bootMetric('catalog',new Date().getTime()-catalogAt);
        catalogData=catalog;window.XIPTVGlobalCatalog=catalog;sortedCache={};categoryCache={};focusCache=null;currentPage=0;
        trackNewCatalogItems(catalog);
        cacheHome(catalog);
        try{localStorage.setItem('xiptv_webos2_last_catalog_refresh',new Date().toISOString());}catch(e){}
        var updated=document.getElementById('tv-last-catalog-update');if(updated)updated.textContent='Son katalog yenileme: '+new Date().toLocaleString('tr-TR');
        if(!liveCategoryMatches(catalog))setTimeout(retryLiveCatalog,900);
        hide(login);show(browser);
        if(startup){startup=false;hide(panel);document.body.className='';document.getElementById('tv-home').style.display='block';document.getElementById('tv-nav-home').focus();}
        else if(document.getElementById('tv-home').style.display!=='none'){hide(panel);document.body.className='';}
        var paintAt=new Date().getTime();
        setTimeout(function(){
          if(window.XIPTVTVHome&&window.XIPTVTVHome.render)window.XIPTVTVHome.render(catalog);
          window.XIPTVTV.catalogReady();
          if(document.getElementById('tv-home').style.display==='none')chooseMode(window.XIPTVTV.startMode||'live');
          bootMetric('render',new Date().getTime()-paintAt);
        },30);
      });
    });
  };
  var manualRefresh=document.getElementById('tv-manual-catalog-refresh');if(manualRefresh)manualRefresh.onclick=function(){document.getElementById('iptv-connect').click();};
  // Startup: connect silently with saved credentials; show login only on failure.
  if(hydrate()){
    server=document.getElementById('iptv-server').value.trim().replace(/\/+$/,'');
    username=document.getElementById('iptv-user').value.trim();
    password=document.getElementById('iptv-pass').value;
    if(displayCachedHome()){document.getElementById('tv-home').style.display='block';hide(panel);hide(login);hide(browser);bootLock(false);}
    else{show(panel);hide(login);hide(browser);say('İlk katalog alınıyor; sonraki açılış daha hızlı olacak...');}
    document.getElementById('iptv-connect').click();
  }else{
    show(panel);show(login);hide(browser);
    document.getElementById('tv-home').style.display='none';
    say('Xtream hesabını ekleyerek başlayabilirsin.');
  }
})();
