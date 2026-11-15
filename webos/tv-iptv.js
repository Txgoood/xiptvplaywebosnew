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
  var PAGE_SIZE=60, currentPage=0, searchTimer=null, sortedCache={}, focusCache=null, categoryCache={};
  var server='',username='',password='';
  var SAVE_KEY='xiptv_webos2_xtream_local_v1';
  var HOME_CACHE_PREFIX='xiptv_webos2_home_preview_v1_';
  function cacheKey(){var input=server+'|'+username,hash=0;for(var j=0;j<input.length;j++)hash=((hash<<5)-hash+input.charCodeAt(j))|0;return HOME_CACHE_PREFIX+String(hash);}
  function displayCachedHome(){
    try{
      var cached=JSON.parse(localStorage.getItem(cacheKey())||'null');
      if(!cached||!cached.time||new Date().getTime()-cached.time>48*3600000||!cached.data)return false;
      if(window.XIPTVTVHome&&window.XIPTVTVHome.render)window.XIPTVTVHome.render(cached.data);
      return true;
    }catch(e){return false;}
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
  function show(el){el.style.display='block';}
  function hide(el){el.style.display='none';}
  function clear(el){while(el.firstChild)el.removeChild(el.firstChild);}
  function action(parent,label,cb){
    var b=document.createElement('button');b.type='button';b.appendChild(document.createTextNode(label));b.onclick=cb;parent.appendChild(b);return b;
  }
  function request(route,data,callback){
    var xhr=new XMLHttpRequest();
    try{
      xhr.open('POST',BASE+route,true);
      xhr.timeout=45000;
      xhr.setRequestHeader('Content-Type','application/json');
      xhr.onreadystatechange=function(){
        if(xhr.readyState!==4)return;
        var response=null;
        try{response=JSON.parse(xhr.responseText);}catch(err){}
        if(xhr.status<200||xhr.status>=300){callback(new Error(response&&response.error||'HTTP '+xhr.status));return;}
        if(!response){callback(new Error('Sunucu yanıtı okunamadı'));return;}
        callback(null,response);
      };
      xhr.onerror=function(){callback(new Error('Render sunucusuna bağlantı kurulamadı'));};
      xhr.ontimeout=function(){callback(new Error('Sunucu zaman aşımı'));};
      xhr.send(JSON.stringify(data));
    }catch(e){callback(e);}
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
      catalogData.liveStreams=data.liveStreams;
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
  var activeEpisodeQueue=[],activeEpisodeIndex=-1;
  function startEpisode(entry,index){
    if(!entry||!entry.item)return;
    activeEpisodeIndex=index;
    var ep=entry.item,ext=String(ep.container_extension||'mp4').replace(/[^a-zA-Z0-9]/g,'');
    document.getElementById('tv-episodes').style.display='none';
    document.getElementById('tv-next-episode').style.display='none';
    playStream('series',ep.id,ext,ep.title||'Dizi Bölümü');
  }
  function showSeries(item){
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
      say(episodes.length+' bölüm bulundu. Bölüm seç.');
    }
    if(cached)onSeries(null,cached);
    else request('/api/iptv/xtream/series_info',{serverUrl:server,username:username,password:password,seriesId:id},onSeries);
  }
  video.addEventListener('ended',function(){
    if(!lastSeries||activeEpisodeIndex<0||activeEpisodeIndex+1>=activeEpisodeQueue.length)return;
    var next=document.getElementById('tv-next-episode'),entry=activeEpisodeQueue[activeEpisodeIndex+1];
    document.getElementById('tv-next-episode-label').textContent='Sıradaki: Sezon '+entry.season+' · '+String(entry.item.title||entry.item.episode_num||'Bölüm');
    next.style.display='block';document.getElementById('tv-next-episode-play').focus();
  },false);
  document.getElementById('tv-next-episode-play').onclick=function(){startEpisode(activeEpisodeQueue[activeEpisodeIndex+1],activeEpisodeIndex+1);};
  document.getElementById('tv-next-episode-close').onclick=function(){document.getElementById('tv-next-episode').style.display='none';};
  function playStream(kind,id,ext,name){
    if(kind!=='series'){activeEpisodeIndex=-1;document.getElementById('tv-next-episode').style.display='none';}
    if(id===null||typeof id==='undefined'){say('Yayın kimliği eksik');return;}
    var suffix=ext|| (kind==='live'?'m3u8':'mp4');
    var url=server.replace(/\/$/,'')+'/'+kind+'/'+encodeURIComponent(username)+'/'+encodeURIComponent(password)+'/'+encodeURIComponent(id)+'.'+suffix;
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
  function renderChannels(){
    focusCache=null;
    clear(channels);
    var count=0;
    var query=(document.getElementById('tv-search').value||'').toLowerCase(),searchScope=document.getElementById('tv-search-scope').value;
    var sorting=document.getElementById('tv-sort').value;
    var cacheKey=mode+'|'+sorting;
    var list=sortedCache[cacheKey];
    if(!list){list=channelList.slice(0);if(sorting==='old'||sorting==='new')list.sort(function(a,b){var x=Number(a.added||a.release_date||a.year||0),y=Number(b.added||b.release_date||b.year||0);return sorting==='old'?x-y:y-x;});if(sorting==='az')list.sort(function(a,b){return String(a.name||'').localeCompare(String(b.name||''));});if(sorting==='za')list.sort(function(a,b){return String(b.name||'').localeCompare(String(a.name||''));});sortedCache[cacheKey]=list;}
    var matches=[];
    var totalStreams=channelList.length;
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
    for(var i=0;i<list.length;i++){
      var ch=list[i];
      if(selectedCategory!=='all' && String(ch.category_id)!==selectedCategory)continue;
      if(query){var inName=String(ch.name||ch.title||'').toLowerCase().indexOf(query)>=0;var inCategory=String(categoryNames[String(ch.category_id)]||'').toLowerCase().indexOf(query)>=0;if(searchScope==='name'&&!inName||searchScope==='category'&&!inCategory||searchScope==='all'&&!inName&&!inCategory)continue;}
      if(!window.XIPTVTV.filterFavorite(mode,ch))continue;
      if(window.XIPTVTV.canShowItem&&!window.XIPTVTV.canShowItem(mode,ch))continue;
      var catLabel=categoryNames[String(ch.category_id)]||'';
      if(document.getElementById('tv-tr-only').checked && catLabel.toUpperCase().indexOf('TR')!==0)continue;
      if(document.getElementById('tv-hide-adult').checked && /^(XXX|18\+|ADULT|🔞|❤)/i.test(catLabel))continue;
      matches.push(ch);
    }
    // Preserve the category/filter/sort order for fullscreen channel zapping.
    // Only a live list becomes a channel-change source; films and series never do.
    if(mode==='live')liveChannelOrder=matches.slice(0);
    var totalPages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));
    if(currentPage>=totalPages)currentPage=totalPages-1;
    if(currentPage>0)action(channels,'◀ Önceki sayfa',function(){currentPage--;renderChannels();channels.scrollTop=0;});
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
              image.onerror=function(){sourceIndex++;if(sourceIndex<sources.length)image.src=sources[sourceIndex];else{image.style.display='none';fallback.style.display='block';}};
              image.src=sources[0];line.appendChild(image);
            }
          }else if(/^https?:\/\//i.test(picture)){
            var img=document.createElement('img');img.src=picture;
            img.alt='';img.loading='lazy';
            img.onerror=function(){this.style.display='none';};
            line.appendChild(img);
          }else{
            var placeholder=document.createElement('span');
            placeholder.className='tv-poster-placeholder';
            placeholder.textContent='FİLM';
            line.appendChild(placeholder);
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
    if(currentPage+1<totalPages)action(channels,'Sonraki sayfa ▶ ('+(currentPage+2)+'/'+totalPages+')',function(){currentPage++;renderChannels();channels.scrollTop=0;});
    if(!matches.length){
      if(mode==='live' && !document.getElementById('tv-search').value && !document.getElementById('tv-favorite-only').checked && liveRetryCount<2) setTimeout(retryLiveCatalog,700);
      var empty=document.createElement('div');empty.className='tv-empty-results';
      empty.textContent=totalStreams===0?'Canlı TV kanal verisi sunucudan boş geldi. Katalog yeniden yüklenmeli.':'Bu kategoride eşleşen kanal bulunamadı ('+totalStreams+' kayıt yüklendi).';
      channels.appendChild(empty);
      if(mode==='live')action(channels,'Kanal listesini yeniden yükle',function(){document.getElementById('iptv-connect').click();});
    }
    say(matches.length+' içerik bulundu; '+totalStreams+' kayıt yüklü. Sayfa '+(currentPage+1)+'/'+totalPages+'.');
  }
  function renderCategories(){
    focusCache=null;
    clear(categories);
    action(categories,'Tümü',function(){selectedCategory='all';currentPage=0;renderChannels();});
    for(var i=0;i<categoryList.length;i++){
      (function(c){var label=String(c.category_name||'Kategori');if(document.getElementById('tv-tr-only').checked&&label.toUpperCase().indexOf('TR')!==0)return;if(document.getElementById('tv-hide-adult').checked&&/^(XXX|18\\+|ADULT|🔞|❤)/i.test(label))return;action(categories,label,function(){selectedCategory=String(c.category_id);currentPage=0;renderChannels();});})(categoryList[i]);
    }
    renderChannels();
  }
  var previousChannel=null,numberBuffer='',numberTimer=null;
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
  document.getElementById('tv-advanced-search').onclick=function(){var x=document.getElementById('tv-search-scope');x.style.display=x.style.display==='none'?'inline-block':'none';};
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
  fullBtn.onclick=function(){setClass('tv-fullscreen',!hasClass('tv-fullscreen'));updatePlayerButtons();};
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
      setClass('tv-fullscreen',!hasClass('tv-fullscreen'));
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
    if(key!==37&&key!==38&&key!==39&&key!==40&&key!==13&&key!==461&&key!==27)return;
    if((key===461||key===27)&&hasClass('tv-fullscreen')){setClass('tv-fullscreen',false);updatePlayerButtons();fullBtn.focus();e.preventDefault();e.stopImmediatePropagation();return;}
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
    if(key===461 && panel.style.display!=='none'){hide(panel);document.body.className='';document.getElementById('tv-home').style.display='block';updatePlayerButtons();document.getElementById('tv-nav-home').focus();e.preventDefault();e.stopImmediatePropagation();return;}
    if(key===13 && active && active.tagName==='BUTTON'){
      active.click();e.preventDefault();e.stopImmediatePropagation();return;
    }
    if(key===37||key===38||key===39||key===40){
      // Keep text-field arrow navigation native while typing.
      if(active && active.tagName==='INPUT')return;
      if(list.length){
        var next=list[(idx+(key===37||key===38?-1:1)+list.length)%list.length];
        if(next.offsetWidth&&next.offsetHeight){next.focus();
          if(next.parentNode===channels||next.parentNode&&next.parentNode.parentNode===channels){try{next.scrollIntoView(false);}catch(e){}}}
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
    server=document.getElementById('iptv-server').value.trim().replace(/\/+$/,'');
    username=document.getElementById('iptv-user').value.trim();
    password=document.getElementById('iptv-pass').value;
    if(!server||!username||!password){say('Sunucu, kullanıcı ve şifre zorunludur');show(login);hide(browser);return;}
    if(connecting)return;
    connecting=true;
    if(server.indexOf('http://')!==0 && server.indexOf('https://')!==0)server='http://'+server;
    say('Xtream bağlantısı doğrulanıyor...');
    request('/api/iptv/xtream/verify',{serverUrl:server,username:username,password:password},function(err,data){
      if(err||!data.success){connecting=false;show(panel);show(login);hide(browser);document.getElementById('tv-home').style.display='none';say('Doğrulama başarısız: '+(err?err.message:data.error||'Hesap reddedildi'));return;}
      server=data.effectiveServerUrl||server;
      persistCredentials();
      // A previously verified account can immediately browse a small local home preview,
      // while the complete catalogue is refreshed from the provider.
      if(startup&&displayCachedHome()){
        startup=false;hide(panel);document.body.className='';
        document.getElementById('tv-home').style.display='block';
        document.getElementById('tv-nav-home').focus();
        say('Önizleme hazır; tam katalog güncelleniyor...');
      }else say('Bağlantı başarılı, canlı TV kataloğu alınıyor...');
      request('/api/iptv/xtream/catalog',{serverUrl:server,username:username,password:password},function(error,catalog){
        connecting=false;
        if(error){show(panel);show(login);hide(browser);document.getElementById('tv-home').style.display='none';say('Katalog hatası: '+error.message);return;}
        catalogData=catalog;sortedCache={};categoryCache={};focusCache=null;currentPage=0;
        cacheHome(catalog);
        try{localStorage.setItem('xiptv_webos2_last_catalog_refresh',new Date().toISOString());}catch(e){}
        var updated=document.getElementById('tv-last-catalog-update');if(updated)updated.textContent='Son katalog yenileme: '+new Date().toLocaleString('tr-TR');
        if(!liveCategoryMatches(catalog))setTimeout(retryLiveCatalog,900);
        if(window.XIPTVTVHome&&window.XIPTVTVHome.render)window.XIPTVTVHome.render(catalog);
        window.XIPTVTV.catalogReady();
        hide(login);show(browser);
        if(startup){startup=false;hide(panel);document.body.className='';document.getElementById('tv-home').style.display='block';document.getElementById('tv-nav-home').focus();}
        else if(document.getElementById('tv-home').style.display==='none')chooseMode(window.XIPTVTV.startMode||'live');
        else {hide(panel);document.body.className='';}
      });
    });
  };
  var manualRefresh=document.getElementById('tv-manual-catalog-refresh');if(manualRefresh)manualRefresh.onclick=function(){document.getElementById('iptv-connect').click();};
  // Startup: connect silently with saved credentials; show login only on failure.
  if(hydrate()){
    show(panel);hide(login);hide(browser);say('Katalog otomatik yükleniyor...');document.getElementById('iptv-connect').click();
  }else{
    show(panel);show(login);hide(browser);
    document.getElementById('tv-home').style.display='none';
    say('Xtream hesabını ekleyerek başlayabilirsin.');
  }
})();
