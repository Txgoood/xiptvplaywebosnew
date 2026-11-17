/* XIPTV Play webOS 2 custom player controls. Keep the native video engine unchanged. ES5 only. */
(function(){
 var video=document.getElementById('video'),bar=document.getElementById('tv-player-controls');
 var menu=document.getElementById('tv-player-menu'),toast=document.getElementById('tv-player-toast');
 var seek=document.getElementById('tv-progress'),elapsed=document.getElementById('tv-elapsed'),duration=document.getElementById('tv-duration');
 var title=document.getElementById('tv-player-title'),speed=document.getElementById('tv-speed');
 var lastNotice='',noticeTimer=null,menuKind='',hideTimer=null,lastErrorAt=0;
 var SUB_SETTINGS_KEY='xiptv_webos2_subtitle_appearance_v1';
 function applySubtitleStyle(){
  var layer=document.getElementById('tv-lg-subtitle-overlay');if(!layer)return;
  var size=document.getElementById('tv-subtitle-size'),pos=document.getElementById('tv-subtitle-position'),bg=document.getElementById('tv-subtitle-background');
  if(!size||!pos||!bg)return;
  layer.style.fontSize=size.value+'px';layer.className='tv-sub-position-'+pos.value;
  layer.style.background=bg.checked?'rgba(0,0,0,.62)':'transparent';layer.style.borderRadius=bg.checked?'10px':'0';
  try{localStorage.setItem(SUB_SETTINGS_KEY,JSON.stringify({size:size.value,position:pos.value,background:bg.checked}));}catch(e){}
 }
 try{var remembered=JSON.parse(localStorage.getItem(SUB_SETTINGS_KEY)||'{}');document.getElementById('tv-subtitle-size').value=remembered.size||'32';document.getElementById('tv-subtitle-position').value=remembered.position||'middle';document.getElementById('tv-subtitle-background').checked=!!remembered.background;}catch(e){}
 document.getElementById('tv-subtitle-size').onchange=applySubtitleStyle;
 document.getElementById('tv-subtitle-position').onchange=applySubtitleStyle;
 document.getElementById('tv-subtitle-background').onchange=applySubtitleStyle;
 applySubtitleStyle();
 function byId(id){return document.getElementById(id);}
 function hasFull(){return (' '+document.body.className+' ').indexOf(' tv-fullscreen ')>=0;}
 function finite(n){return typeof n==='number'&&isFinite(n)&&n>=0;}
 function format(sec){if(!finite(sec))return '--:--';sec=Math.floor(sec);var h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return (h?h+':':'')+(h?('0'+m).slice(-2):m)+':'+('0'+s).slice(-2);}
 function isLive(){return !(finite(video.duration)&&video.duration>0&&video.duration!==Infinity);}
 function update(){
  var value=video.currentTime,total=video.duration,seekable=!isLive();
  seek.disabled=!seekable;seek.max=seekable?Math.floor(total):100;
  if(seekable){seek.value=finite(value)?Math.min(total,value):0;elapsed.textContent=format(value);duration.textContent=format(total);}
  else{seek.value=0;elapsed.textContent='CANLI';duration.textContent='';}
  var name=byId('tv-now-playing');if(name&&name.textContent)title.textContent=name.textContent;
 }
 function notice(text,kind){
  if(!text)return;
  lastNotice=text;toast.textContent=text;toast.className='tv-toast tv-toast-'+(kind||'info');toast.style.display='block';
  if(noticeTimer)clearTimeout(noticeTimer);
  noticeTimer=setTimeout(function(){toast.style.display='none';},kind==='error'?10000:4500);
 }
 function closeMenu(){menu.style.display='none';menuKind='';menu.innerHTML='';}
 function openMenu(kind){
  if(menuKind===kind&&menu.style.display!=='none'){closeMenu();return;}
  menuKind=kind;menu.innerHTML='';
  var heading=document.createElement('div');heading.className='tv-menu-heading';heading.textContent=kind==='audio'?'Ses Parçası':kind==='subtitle'?'Altyazı':kind==='speed'?'Oynatma Hızı':'Oynatıcı Araçları';menu.appendChild(heading);
  var close=document.createElement('button');close.textContent='✕ Kapat';close.className='tv-menu-close';close.onclick=closeMenu;menu.appendChild(close);
  if(kind==='audio'||kind==='subtitle'){
   if(window.XIPTVTV&&window.XIPTVTV.refreshTracks)window.XIPTVTV.refreshTracks();
   var select=byId(kind==='audio'?'tv-audio':'tv-subtitles');
   var selected=select.value,found=0;
   for(var i=0;i<select.options.length;i++){
    (function(opt){
     var value=String(opt.value),label=String(opt.text||opt.label||value);
     // An informational HLS option is not a track-change control.
     if(value.indexOf('hls:info:')===0)return;
     var b=document.createElement('button');b.className='tv-menu-option'+(value===selected?' active':'');
     b.textContent=(value===selected?'● ':'○ ')+label;
     b.onclick=function(){
      select.value=value;
      if(typeof select.onchange==='function')select.onchange();
      notice((kind==='audio'?'Ses':'Altyazı')+' seçimi: '+label,'info');
      closeMenu();
     };menu.appendChild(b);found++;
    })(select.options[i]);
   }
   if(!found){var msg=document.createElement('p');msg.textContent='Bu yayında seçilebilir parça listesi bulunamadı.';menu.appendChild(msg);}
   var help=byId('tv-track-notice');if(help&&help.textContent){var hint=document.createElement('p');hint.className='tv-menu-note';hint.textContent=help.textContent;menu.appendChild(hint);}
  }else if(kind==='speed'){
   var speeds=[0.5,1,1.5,2,4],current=Number(speed.value)||1;
   if(isLive()){var message=document.createElement('p');message.textContent='Canlı yayında hız değiştirme desteklenmeyebilir.';menu.appendChild(message);}
   for(var j=0;j<speeds.length;j++)(function(rate){
    var b=document.createElement('button');b.className='tv-menu-option'+(rate===current?' active':'');b.textContent=rate+'x';
    b.onclick=function(){speed.value=String(rate);if(typeof speed.onchange==='function')speed.onchange();notice('Oynatma hızı '+rate+'x olarak istendi','info');closeMenu();};menu.appendChild(b);
   })(speeds[j]);
  }else{
   var actions=[['← Geri — kataloğa dön','tv-player-back'],['Ses/altyazı yeniden tara','tv-lg-media-scan'],['MKV parça listesini yenile','tv-mkv-scan'],['Önceki oynatıcıya dön','tv-lg-native-return'],['Alternatif oynatıcı','tv-alt-player'],['Gelişmiş teknik bilgiler','tv-controls-toggle']];
   for(var k=0;k<actions.length;k++)(function(entry){
    var target=byId(entry[1]);if(!target||target.style.display==='none')return;
    var b=document.createElement('button');b.className='tv-menu-option';b.textContent=entry[0];
    b.onclick=function(){closeMenu();target.click();};menu.appendChild(b);
   })(actions[k]);
   var details=['tv-lg-media-status','tv-mkv-status','tv-track-scan-results','tv-track-notice'];
   for(var d=0;d<details.length;d++){var el=byId(details[d]);if(el&&el.textContent){var line=document.createElement('p');line.className='tv-menu-note';line.textContent=el.textContent;menu.appendChild(line);}}
  }
  menu.style.display='block';var buttons=menu.getElementsByTagName('button');if(buttons.length>1)buttons[1].focus();else close.focus();show();
 }
 function show(){bar.style.opacity='1';bar.style.pointerEvents='auto';if(hideTimer)clearTimeout(hideTimer);hideTimer=setTimeout(function(){if(menu.style.display==='none'&&hasFull()){bar.style.opacity='0';bar.style.pointerEvents='none';}},6500);}
 byId('tv-open-audio').onclick=function(){openMenu('audio');};
 byId('tv-open-subtitle').onclick=function(){openMenu('subtitle');};
 byId('tv-open-speed').onclick=function(){openMenu('speed');};
 byId('tv-player-settings').onclick=function(){openMenu('tools');};
 byId('tv-player-favorite').onclick=function(){byId('tv-video-favorite').click();show();};
 seek.oninput=function(){if(!isLive())elapsed.textContent=format(Number(seek.value));};
 seek.onchange=function(){if(!isLive())try{video.currentTime=Number(seek.value);}catch(e){notice('Bu akışta ileri sarma desteklenmiyor.','warning');}show();};
 video.removeAttribute('controls');video.controls=false;
 function noNative(){if(video.controls){video.controls=false;video.removeAttribute('controls');}}
 video.addEventListener('loadedmetadata',function(){noNative();update();});
 video.addEventListener('timeupdate',update);
 video.addEventListener('durationchange',update);
 video.addEventListener('playing',function(){noNative();update();});
 video.addEventListener('error',function(){var now=new Date().getTime();if(now-lastErrorAt<1200)return;lastErrorAt=now;notice('Oynatma hatası: Kaynak açılamadı. Yayını yeniden deneyin.','error');});
 video.addEventListener('waiting',function(){notice('Yayın yükleniyor veya bağlantı bekleniyor…','warning');});
 video.addEventListener('canplay',function(){if(toast.className.indexOf('warning')>=0)toast.style.display='none';});
 document.addEventListener('keydown',function(e){if(menu.style.display!=='none'&&(e.keyCode===461||e.keyCode===27)){closeMenu();show();e.preventDefault();}},false);
 window.XIPTVPlayerUI={menuOpen:function(){return menu.style.display!=='none';},onKey:function(key){
  if(menu.style.display==='none')return false;
  if(key===461||key===27){closeMenu();show();return true;}
  var buttons=menu.getElementsByTagName('button'),index=-1,i;for(i=0;i<buttons.length;i++)if(buttons[i]===document.activeElement)index=i;
  if(key===38||key===40){if(buttons.length){var next=(index+(key===38?-1:1)+buttons.length)%buttons.length;buttons[next].focus();}return true;}
  if(key===13){if(index>=0)buttons[index].click();return true;}
  return key===37||key===39;
 },notice:notice,update:update,closeMenu:closeMenu};
 update();
})();