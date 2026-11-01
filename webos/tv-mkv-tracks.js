/* XIPTV MKV track reader for LG webOS 2 (ES5 only).
   Many webOS firmwares decode embedded MKV audio/subtitle streams but expose neither
   video.audioTracks nor video.textTracks, and the optional remote FFprobe service may be
   asleep, blocked or unreachable. This module reads the Matroska header directly on the TV
   (one small HTTP Range request) so the audio/subtitle list is always shown.
   Selecting a track is delegated to the TV media pipeline (luna selectTrack) and is verified;
   on failure the previous track is restored. Playback is never replaced by this module. */
(function(){
var win=window,doc=win.document;
var HEAD_BYTES=786432,TRACKS_BYTES=196608,START_DELAY=900;
var ID_EBML=0x1A45DFA3,ID_SEGMENT=0x18538067,ID_SEEKHEAD=0x114D9B74,ID_TRACKS=0x1654AE6B,ID_CLUSTER=0x1F43B675;
var state={url:'',tracks:[],audio:[],subs:[],status:'',gen:0,xhr:null,timer:null,audioSel:-1,subSel:-1};

function $(id){return doc&&doc.getElementById?doc.getElementById(id):null;}
function say(text){state.status=String(text||'');var el=$('tv-mkv-status');if(el)el.textContent=state.status;}

var LANG={tur:'Türkçe',tr:'Türkçe',eng:'İngilizce',en:'İngilizce',ger:'Almanca',deu:'Almanca',de:'Almanca',fre:'Fransızca',fra:'Fransızca',fr:'Fransızca',spa:'İspanyolca',es:'İspanyolca',ita:'İtalyanca',it:'İtalyanca',rus:'Rusça',ru:'Rusça',ara:'Arapça',ar:'Arapça',por:'Portekizce',pt:'Portekizce',jpn:'Japonca',ja:'Japonca',kor:'Korece',ko:'Korece',chi:'Çince',zho:'Çince',zh:'Çince',pol:'Lehçe',pl:'Lehçe',dut:'Felemenkçe',nld:'Felemenkçe',swe:'İsveççe',und:'Bilinmeyen dil'};
function languageName(code){
 var c=String(code||'und').toLowerCase().split('-')[0];
 return LANG[c]||c;
}
var CODEC={'A_AC3':'AC3','A_EAC3':'E-AC3','A_DTS':'DTS','A_TRUEHD':'TrueHD','A_OPUS':'Opus','A_VORBIS':'Vorbis','A_FLAC':'FLAC','A_MPEG/L3':'MP3','A_MPEG/L2':'MP2','S_TEXT/UTF8':'SRT','S_TEXT/ASS':'ASS','S_TEXT/SSA':'SSA','S_TEXT/WEBVTT':'WebVTT','S_HDMV/PGS':'PGS (görüntü)','S_VOBSUB':'VobSub (görüntü)','S_DVBSUB':'DVB (görüntü)'};
function codecName(id){
 id=String(id||'');
 if(CODEC[id])return CODEC[id];
 if(id.indexOf('A_AAC')===0)return 'AAC';
 if(id.indexOf('A_DTS')===0)return 'DTS';
 return id.replace(/^[ASV]_/,'');
}
function channelText(n){return n===1?'1.0':n===2?'2.0':n===6?'5.1':n===8?'7.1':n>0?n+' kanal':'';}

/* ---- EBML / Matroska parsing over a binary string or any byte array ---- */
function reader(src){
 if(typeof src==='string')return {length:src.length,at:function(i){return src.charCodeAt(i)&255;}};
 return {length:src.length,at:function(i){return src[i]&255;}};
}
function readId(r,pos){
 if(pos>=r.length)return null;
 var b=r.at(pos),len=1,mask=0x80,v=0,i;
 while(len<=4&&!(b&mask)){mask>>=1;len++;}
 if(len>4||pos+len>r.length)return null;
 for(i=0;i<len;i++)v=v*256+r.at(pos+i);
 return {value:v,len:len};
}
function readSize(r,pos){
 if(pos>=r.length)return null;
 var b=r.at(pos),len=1,mask=0x80,i,c,v,ones;
 while(len<=8&&!(b&mask)){mask>>=1;len++;}
 if(len>8||pos+len>r.length)return null;
 v=b&(mask-1);ones=(v===mask-1);
 for(i=1;i<len;i++){c=r.at(pos+i);if(c!==255)ones=false;v=v*256+c;}
 return {value:ones?-1:v,len:len};
}
function readUInt(r,pos,len){var v=0,i;for(i=0;i<len&&i<8;i++)v=v*256+r.at(pos+i);return v;}
function readText(r,pos,len){
 var s='',i,c;
 for(i=0;i<len;i++){c=r.at(pos+i);if(c===0)break;s+=String.fromCharCode(c);}
 try{return decodeURIComponent(escape(s));}catch(e){return s;}
}
function eachChild(r,start,end,cb){
 var pos=start;
 while(pos<end&&pos<r.length){
  var id=readId(r,pos);if(!id)return;
  var sz=readSize(r,pos+id.len);if(!sz)return;
  var data=pos+id.len+sz.len,size=sz.value;
  if(size<0||data+size>end)size=end-data;
  if(cb(id.value,data,size)===false)return;
  pos=data+size;
 }
}
function parseEntry(r,start,end){
 var t={number:0,type:0,lang:'eng',name:'',codec:'',channels:0,def:false,forced:false,enabled:true};
 eachChild(r,start,end,function(id,d,size){
  if(id===0xD7)t.number=readUInt(r,d,size);
  else if(id===0x83)t.type=readUInt(r,d,size);
  else if(id===0x22B59C){if(!t.bcp)t.lang=readText(r,d,size)||'eng';}
  else if(id===0x22B59D){t.bcp=true;t.lang=readText(r,d,size)||t.lang;}
  else if(id===0x536E)t.name=readText(r,d,size);
  else if(id===0x86)t.codec=readText(r,d,size);
  else if(id===0x88)t.def=readUInt(r,d,size)===1;
  else if(id===0x55AA)t.forced=readUInt(r,d,size)===1;
  else if(id===0xB9)t.enabled=readUInt(r,d,size)!==0;
  else if(id===0xE1)eachChild(r,d,d+size,function(i2,d2,s2){if(i2===0x9F)t.channels=readUInt(r,d2,s2);});
 });
 return t;
}
function parseTracksElement(r,start,end){
 var out=[],ai=0,si=0;
 eachChild(r,start,end,function(id,d,size){
  if(id!==0xAE)return;
  var t=parseEntry(r,d,d+size);
  if(t.type===2){t.kind='audio';t.typeIndex=ai++;out.push(t);}
  else if(t.type===17){t.kind='subtitle';t.typeIndex=si++;out.push(t);}
 });
 return out;
}
function readSeekHead(r,start,end,seek){
 eachChild(r,start,end,function(id,d,size){
  if(id!==0x4DBB)return;
  var target=-1,where=-1;
  eachChild(r,d,d+size,function(i2,d2,s2){
   if(i2===0x53AB)target=readUInt(r,d2,s2);
   else if(i2===0x53AC)where=readUInt(r,d2,s2);
  });
  if(target>=0&&where>=0)seek[target]=where;
 });
}
/* First buffer = file offset 0. Returns {tracks}, {need:absoluteOffset} or {error}. */
function parseHead(src){
 var r=reader(src),id=readId(r,0),sz,pos,segData,seek={},p,eid,esz,d,e,tp;
 if(!id||id.value!==ID_EBML)return {error:'not-mkv'};
 sz=readSize(r,id.len);
 if(!sz||sz.value<0)return {error:'bad-header'};
 pos=id.len+sz.len+sz.value;
 id=readId(r,pos);
 if(!id||id.value!==ID_SEGMENT)return {error:'no-segment'};
 sz=readSize(r,pos+id.len);
 if(!sz)return {error:'bad-segment'};
 segData=pos+id.len+sz.len;p=segData;
 while(p<r.length){
  eid=readId(r,p);if(!eid)break;
  esz=readSize(r,p+eid.len);if(!esz)break;
  if(eid.value===ID_CLUSTER||esz.value<0)break;
  d=p+eid.len+esz.len;e=d+esz.value;
  if(eid.value===ID_TRACKS){
   if(e<=r.length)return {tracks:parseTracksElement(r,d,e)};
   return {need:p};
  }
  if(eid.value===ID_SEEKHEAD&&e<=r.length)readSeekHead(r,d,e,seek);
  p=e;
 }
 tp=seek[ID_TRACKS];
 if(typeof tp==='number')return {need:segData+tp};
 return {tracks:[]};
}
/* Second buffer starts exactly at the Tracks element. */
function parseTracksAt(src){
 var r=reader(src),id=readId(r,0),sz;
 if(!id||id.value!==ID_TRACKS)return {error:'no-tracks'};
 sz=readSize(r,id.len);
 if(!sz||sz.value<0||id.len+sz.len+sz.value>r.length)return {error:'tracks-too-large'};
 return {tracks:parseTracksElement(r,id.len+sz.len,id.len+sz.len+sz.value)};
}

/* ---- Range request (works even if the server ignores Range: aborts after enough bytes) ---- */
function abortActive(){
 if(state.timer){clearTimeout(state.timer);state.timer=null;}
 if(state.xhr){try{state.xhr.abort();}catch(e){}state.xhr=null;}
}
function fetchRange(url,start,length,cb){
 var x=new XMLHttpRequest(),done=false;
 function finish(err,text){if(done)return;done=true;if(state.xhr===x)state.xhr=null;cb(err,text);}
 try{
  x.open('GET',url,true);
  x.overrideMimeType('text/plain; charset=x-user-defined');
  x.setRequestHeader('Range','bytes='+start+'-'+(start+length-1));
  x.timeout=25000;
  x.onprogress=function(){
   if(done)return;
   if(start>0&&x.status===200){try{x.abort();}catch(e){}finish(new Error('range-unsupported'));return;}
   var text=x.responseText;
   if(text&&text.length>=length){var piece=text.substr(0,length);try{x.abort();}catch(e){}finish(null,piece);}
  };
  x.onload=function(){
   if(x.status===200&&start>0){finish(new Error('range-unsupported'));return;}
   if(x.status!==200&&x.status!==206){finish(new Error('HTTP '+x.status));return;}
   finish(null,String(x.responseText||'').substr(0,length));
  };
  x.onerror=function(){finish(new Error('network'));};
  x.ontimeout=function(){finish(new Error('timeout'));};
  state.xhr=x;
  x.send(null);
 }catch(e){finish(e);}
}

/* ---- state, menus ---- */
function reason(err){
 var m=String(err&&err.message||err||'');
 if(m==='not-mkv')return 'Dosya Matroska (MKV) başlığı içermiyor.';
 if(m==='range-unsupported')return 'IPTV sunucusu Range isteğini desteklemiyor.';
 if(m==='timeout')return 'IPTV sunucusu zaman aşımına uğradı.';
 if(m==='network')return 'IPTV sunucusuna ikinci bağlantı kurulamadı (sağlayıcı tek bağlantıya izin veriyor olabilir).';
 if(m.indexOf('HTTP ')===0)return 'IPTV sunucusu '+m+' döndürdü.';
 return 'MKV başlığı çözümlenemedi ('+m+').';
}
function refresh(){if(win.XIPTVTV&&win.XIPTVTV.refreshTracks)win.XIPTVTV.refreshTracks();}
function apply(tracks,gen){
 if(gen!==state.gen)return;
 var i,t;
 state.tracks=tracks;state.audio=[];state.subs=[];
 for(i=0;i<tracks.length;i++){t=tracks[i];if(t.kind==='audio')state.audio.push(t);else state.subs.push(t);}
 state.audioSel=-1;state.subSel=-1;
 for(i=0;i<state.audio.length;i++)if(state.audio[i].def){state.audioSel=i;break;}
 if(state.audioSel<0&&state.audio.length)state.audioSel=0;
 if(!tracks.length)say('MKV başlığında ses veya altyazı parçası bulunamadı.');
 else say('MKV başlığından '+state.audio.length+' ses, '+state.subs.length+' altyazı parçası okundu.');
 refresh();
}
function load(gen){
 if(gen!==state.gen||!state.url)return;
 say('MKV başlığından ses/altyazı listesi okunuyor…');
 fetchRange(state.url,0,HEAD_BYTES,function(err,text){
  if(gen!==state.gen)return;
  if(err){say(reason(err));return;}
  var first=parseHead(text);
  if(first.error){say(reason(new Error(first.error)));return;}
  if(first.tracks){apply(first.tracks,gen);return;}
  fetchRange(state.url,first.need,TRACKS_BYTES,function(err2,text2){
   if(gen!==state.gen)return;
   if(err2){say(reason(err2));return;}
   var second=parseTracksAt(text2);
   if(second.error){say(reason(new Error(second.error)));return;}
   apply(second.tracks,gen);
  });
 });
}
function setSource(data){
 state.gen++;abortActive();
 state.url='';state.tracks=[];state.audio=[];state.subs=[];state.audioSel=-1;state.subSel=-1;say('');
 if(!data||!data.url)return;
 var ext=String(data.extension||'').toLowerCase();
 if(ext!=='mkv'&&ext!=='webm'&&ext!=='mka')return;
 state.url=String(data.url);
 var gen=state.gen;
 state.timer=setTimeout(function(){state.timer=null;load(gen);},START_DELAY);
}
function rescan(){
 if(!state.url){say('Bu içerik MKV değil veya henüz bir film/dizi açılmadı.');return;}
 state.gen++;abortActive();load(state.gen);
}
function trackLabel(t){
 var parts=[languageName(t.lang)];
 if(t.name)parts.push(t.name);
 var tail=codecName(t.codec);
 if(t.kind==='audio'&&t.channels)tail+=' '+channelText(t.channels);
 var flags=(t.def?' • varsayılan':'')+(t.forced?' • zorunlu':'');
 return parts.join(' · ')+' ('+tail+')'+flags;
}
function addOption(sel,label,value){
 var i,o;
 for(i=0;i<sel.options.length;i++)if(sel.options[i].value===value)return;
 o=doc.createElement('option');o.value=value;o.text=label;sel.appendChild(o);
}
function extendMenus(sub,aud,nativeTextCount,nativeAudioCount){
 var i,t;
 if(state.audio.length>(nativeAudioCount||0))
  for(i=0;i<state.audio.length;i++){t=state.audio[i];addOption(aud,'MKV: '+trackLabel(t),'mkv:a:'+t.typeIndex);}
 if(state.subs.length>(nativeTextCount||0))
  for(i=0;i<state.subs.length;i++){t=state.subs[i];addOption(sub,'MKV: '+trackLabel(t),'mkv:s:'+t.typeIndex);}
 if(state.audioSel>=0)try{aud.value='mkv:a:'+state.audioSel;}catch(e){}
}
function notice(){
 if(!state.tracks.length)return state.status&&state.status.indexOf('okundu')<0?state.status:'';
 return 'MKV başlığından '+state.audio.length+' ses, '+state.subs.length+' altyazı okundu. Seçim TV medya motoruna iletilir; görüntü tabanlı (PGS/VobSub) altyazılar TV tarafından çizilir.';
}

/* ---- selection via the TV media pipeline (luna selectTrack), verified, with rollback ---- */
function luna(method,params,cb){
 var uri='luna://com.webos.media',done=false,bridge=null;
 function finish(res){
  if(done)return;done=true;
  try{if(bridge&&bridge.cancel)bridge.cancel();}catch(e){}
  cb(res);
 }
 try{
  if(win.webOS&&win.webOS.service&&typeof win.webOS.service.request==='function'){
   win.webOS.service.request(uri,{method:method,parameters:params,
    onSuccess:function(r){finish({ok:true,data:r});},
    onFailure:function(e){finish({ok:false,error:String(e&&(e.errorText||e.message)||'reddedildi')});}});
  }else if(typeof win.PalmServiceBridge==='function'){
   bridge=new win.PalmServiceBridge();
   bridge.onservicecallback=function(raw){
    var r={};try{r=JSON.parse(raw);}catch(e){}
    if(r&&r.returnValue===false)finish({ok:false,error:String(r.errorText||r.errorCode||'reddedildi')});
    else finish({ok:true,data:r});
   };
   bridge.call(uri+'/'+method,JSON.stringify(params));
  }else finish({ok:false,error:'webOS medya servisi bu uygulamada erişilebilir değil'});
 }catch(e){finish({ok:false,error:String(e&&e.message||e)});}
 setTimeout(function(){finish({ok:false,error:'yanıt gelmedi'});},6000);
}
function stalledAfter(ms,onStalled){
 var video=$('video');if(!video)return;
 var t0=video.currentTime||0;
 setTimeout(function(){
  if(video.paused||video.ended)return;
  if((video.currentTime||0)<=t0+0.4)onStalled();
 },ms);
}
function choose(kind,index){
 var video=$('video'),mediaId='';
 try{mediaId=String(video&&video.mediaId||'');}catch(e){}
 if(!mediaId){say('Bu TV oynatıcısı mediaId vermediği için parça seçimi uygulanamıyor.');return;}
 var type=kind==='audio'?'audio':'text',previous=kind==='audio'?state.audioSel:state.subSel;
 say((kind==='audio'?'Ses':'Altyazı')+' parçası TV medya motoruna iletiliyor…');
 luna('selectTrack',{mediaId:mediaId,type:type,index:index},function(res){
  if(!res.ok){say('TV medya motoru '+(kind==='audio'?'ses':'altyazı')+' değişimini kabul etmedi: '+res.error);return;}
  if(kind==='audio')state.audioSel=index;else state.subSel=index;
  say((kind==='audio'?'Ses':'Altyazı')+' seçimi TV medya motoruna iletildi.');
  if(kind==='audio'&&previous>=0&&previous!==index)stalledAfter(4500,function(){
   luna('selectTrack',{mediaId:mediaId,type:'audio',index:previous},function(back){
    state.audioSel=previous;
    say('Seçilen ses parçasıyla oynatma ilerlemedi; önceki ses parçasına dönüldü'+(back.ok?'.':' (geri dönüş de yanıtsız kaldı).'));
    refresh();
   });
  });
 });
}
(function bind(){
 var aud=$('tv-audio'),sub=$('tv-subtitles'),scan=$('tv-mkv-scan');
 if(aud&&aud.addEventListener)aud.addEventListener('change',function(){
  if(this.value.indexOf('mkv:a:')===0)choose('audio',Number(this.value.split(':')[2]));
 },false);
 if(sub&&sub.addEventListener)sub.addEventListener('change',function(){
  if(this.value.indexOf('mkv:s:')===0)choose('subtitle',Number(this.value.split(':')[2]));
 },false);
 if(scan)scan.onclick=rescan;
})();

win.XIPTVMkv={
 setSource:setSource,
 rescan:rescan,
 extendMenus:extendMenus,
 notice:notice,
 tracks:function(){return state.tracks.slice(0);},
 parseHead:parseHead,
 parseTracksAt:parseTracksAt
};
})();
