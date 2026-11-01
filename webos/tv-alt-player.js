/* Optional Shaka engine for compatible LG webOS models; native playback remains default. ES5. */
(function(){
 var video=document.getElementById('video'),status=document.getElementById('tv-alt-player-status');
 var toggle=document.getElementById('tv-alt-player'),back=document.getElementById('tv-alt-return');
 var player=null,oldSource='',oldTime=0,busy=false,active=false;
 function say(message){if(status)status.textContent=message;}
 function restore(reason){
  if(player){try{player.destroy();}catch(e){}player=null;}
  active=false;busy=false;
  if(toggle)toggle.disabled=false;
  if(back)back.style.display='none';
  if(oldSource){try{video.pause();video.src=oldSource;video.load();video.addEventListener('loadedmetadata',function resume(){video.removeEventListener('loadedmetadata',resume,false);try{video.currentTime=oldTime;}catch(e){}var promise=video.play();if(promise&&promise.catch)promise.catch(function(){});},false);}catch(e){}}
  say(reason||'Eski oynatıcı geri yüklendi.');
 }
 function start(){
  if(busy||active)return;
  var src=video.currentSrc||video.src||'';
  if(!src){say('Önce bir yayın aç.');return;}
  if(!/\.(m3u8|mpd)(?:[?#]|$)/i.test(src)){say('Shaka testi yalnızca HLS/DASH akışlarında kullanılabilir. MKV için mevcut oynatıcı korunuyor.');return;}
  oldSource=src;oldTime=video.currentTime||0;busy=true;toggle.disabled=true;
  say('Alternatif motor uygunluğu kontrol ediliyor…');
  function launch(){
   if(!window.shaka||!shaka.Player){restore('Shaka motoru yüklenemedi.');return;}
   try{
    if(shaka.polyfill&&shaka.polyfill.installAll)shaka.polyfill.installAll();
    if(!shaka.Player.isBrowserSupported()){restore('Bu LG webOS sürümü Shaka motorunu desteklemiyor.');return;}
    player=new shaka.Player(video);
    player.addEventListener('error',function(){if(active)restore('Alternatif oynatıcı hata verdi; eski motor açıldı.');});
    video.pause();
    Promise.resolve(player.load(src,oldTime)).then(function(){
     active=true;busy=false;toggle.disabled=false;back.style.display='inline-block';
     var texts=player.getTextTracks?player.getTextTracks():[],audios=player.getVariantTracks?player.getVariantTracks():[];
     var audioMenu=document.getElementById('tv-audio'),subtitleMenu=document.getElementById('tv-subtitles');
     function add(menu,name,value){if(!menu)return;var option=document.createElement('option');option.textContent=name;option.value=value;menu.appendChild(option);}
     for(var ai=0;ai<audios.length;ai++)add(audioMenu,'Shaka: '+(audios[ai].language||'Bilinmeyen')+' '+(audios[ai].height||''),'shaka:a:'+ai);
     for(var si=0;si<texts.length;si++)add(subtitleMenu,'Shaka: '+(texts[si].language||'Bilinmeyen'),'shaka:s:'+si);
     say('Alternatif motor aktif: '+audios.length+' görüntü/ses varyantı, '+texts.length+' altyazı. MKV içi parçalar desteklenmeyebilir.');
     var play=video.play();if(play&&play.catch)play.catch(function(){});
    }).catch(function(){restore('Alternatif motor akışı açamadı; eski motor geri yüklendi.');});
   }catch(e){restore('Alternatif motor uyumlu değil; eski motor geri yüklendi.');}
  }
  if(window.shaka){launch();return;}
  var script=document.createElement('script');script.src='https://cdnjs.cloudflare.com/ajax/libs/shaka-player/3.3.20/shaka-player.compiled.js';
  script.onload=launch;script.onerror=function(){restore('Shaka kütüphanesi yüklenemedi.');};
  document.getElementsByTagName('head')[0].appendChild(script);
  setTimeout(function(){if(busy&&!active)restore('Alternatif oynatıcı zaman aşımı; eski motor geri yüklendi.');},12000);
 }
 document.getElementById('tv-audio').addEventListener('change',function(){
  if(!active||!player||this.value.indexOf('shaka:a:')!==0)return;
  var list=player.getVariantTracks(),index=Number(this.value.split(':')[2]);
  if(list[index])try{player.selectVariantTrack(list[index],true);}catch(e){say('Ses kanalı değiştirilemedi.');}
 },false);
 document.getElementById('tv-subtitles').addEventListener('change',function(){
  if(!active||!player||this.value.indexOf('shaka:s:')!==0)return;
  var list=player.getTextTracks(),index=Number(this.value.split(':')[2]);
  if(list[index])try{player.selectTextTrack(list[index]);player.setTextTrackVisibility(true);}catch(e){say('Altyazı değiştirilemedi.');}
 },false);
 toggle.onclick=start;back.onclick=function(){restore('Eski oynatıcıya dönüldü.');};
 window.XIPTVAltPlayer={beforeSourceChange:function(){if(player){try{player.destroy();}catch(e){}player=null;}active=false;busy=false;oldSource='';if(back)back.style.display='none';if(toggle)toggle.disabled=false;}};
})();