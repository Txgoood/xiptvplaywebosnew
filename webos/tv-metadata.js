/* XIPTV Play webOS 2 metadata bridge, ES5. TMDb token remains on Render. */
(function(){
var BASE='https://xiptvplay.onrender.com',CACHE_KEY='xiptv_webos2_tmdb_meta_v1',AGE_KEY='xiptv_webos2_age_v1';
var cache={},ages={},pending={},queue=[],running=false,requests=0,MAX_LOOKUPS=24;
function load(key){try{return JSON.parse(localStorage.getItem(key)||'{}')||{};}catch(e){return {};}}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch(e){}}
cache=load(CACHE_KEY);ages=load(AGE_KEY);
function itemKey(item,type){return (type==='series'?'series':'movie')+':'+String(item.series_id||item.stream_id||item.id||'')+':'+String(item.name||item.title||'').slice(0,100);}
function parse(xhr){try{return JSON.parse(xhr.responseText||'{}');}catch(e){return {};}}
function hasPoster(url){return /^https:\/\//i.test(String(url||''));}
function keyFor(item,type){return (type==='series'?'series':'movie')+':'+String(item.name||item.title||'').toLowerCase().replace(/\s+/g,' ').slice(0,100)+':'+String(item.year||'');}
function lookup(item,type,callback){
 var key=keyFor(item,type),entry=cache[key],now=new Date().getTime();
 if(entry&&entry.until>now){callback(entry.value||null);return;}
 if(pending[key]){pending[key].push(callback);return;}
 if(requests>=MAX_LOOKUPS||queue.length>30){callback(null);return;}
 pending[key]=[callback];queue.push({item:item,type:type,key:key});pump();
}
function pump(){
 if(running||!queue.length||requests>=MAX_LOOKUPS)return;
 running=true;requests++;
 var task=queue.shift(),item=task.item,query='?type='+encodeURIComponent(task.type==='series'?'series':'movie')+
 '&title='+encodeURIComponent(String(item.name||item.title||''))+(item.year?'&year='+encodeURIComponent(String(item.year)):'');
 var xhr=new XMLHttpRequest();xhr.open('GET',BASE+'/api/tmdb/details'+query,true);xhr.timeout=14000;
 function end(value){
  var valid=value&&typeof value==='object'&&!value.error&&value.title?value:null;
  cache[task.key]={until:new Date().getTime()+(valid?604800000:3600000),value:valid};
  var keys=Object.keys(cache);if(keys.length>120){delete cache[keys[0]];}
  save(CACHE_KEY,cache);
  var callbacks=pending[task.key]||[];delete pending[task.key];running=false;
  for(var i=0;i<callbacks.length;i++)try{callbacks[i](valid);}catch(e){}
  setTimeout(pump,450);
 }
 xhr.onload=function(){end(xhr.status>=200&&xhr.status<300?parse(xhr):null);};
 xhr.onerror=function(){end(null);};xhr.ontimeout=function(){end(null);};
 try{xhr.send();}catch(e){end(null);}
}
function usePoster(image,item,type){
 if(!image||!item)return;
 var fallbackDone=false;
 function missing(){
  if(fallbackDone)return;fallbackDone=true;lookup(item,type,function(meta){
   if(meta&&hasPoster(meta.poster)){
    image.onerror=function(){image.style.display='none';};
    image.src=meta.poster;image.style.display='block';
   }else image.style.display='none';
  });
 }
 image.onerror=missing;
 var url=String(image.getAttribute('src')||'');
 if(!url)missing();
}
function normalizedTitle(value){return String(value||'').toLowerCase().replace(/[ıİ]/g,'i').replace(/\\b(19|20)\\d{2}\\b/g,'').replace(/\\b(4k|uhd|1080p|720p|tr dublaj)\\b/g,'').replace(/[^a-z0-9çğıöşü]+/gi,' ').replace(/^\\s+|\\s+$/g,'');}
function collectionParts(collectionId,callback){
 var id=Number(collectionId);if(!id||id<1){callback(null);return;}
 var xhr=new XMLHttpRequest();xhr.open('GET',BASE+'/api/tmdb/details?collectionId='+encodeURIComponent(id),true);xhr.timeout=14000;
 xhr.onload=function(){callback(xhr.status>=200&&xhr.status<300?parse(xhr):null);};xhr.onerror=function(){callback(null);};xhr.ontimeout=function(){callback(null);};
 try{xhr.send();}catch(e){callback(null);}
}
function showDetails(item,type,play){
 var modal=document.getElementById('tv-metadata-modal');
 if(!modal)return;
 var title=document.getElementById('tv-metadata-title'),summary=document.getElementById('tv-metadata-summary'),facts=document.getElementById('tv-metadata-facts'),poster=document.getElementById('tv-metadata-poster');
 var name=String(item.name||item.title||'İçerik');
 var related=document.getElementById('tv-metadata-related'),collectionButton=document.getElementById('tv-metadata-collection'),actors=document.getElementById('tv-metadata-actors');
 while(related.firstChild)related.removeChild(related.firstChild);collectionButton.style.display='none';actors.style.display='none';
 title.textContent=name;summary.textContent=String(item.plot||item.description||'İçerik bilgileri yükleniyor…');
 facts.textContent=String(item.year||'')+' '+String(item.rating||'');poster.style.display='none';
 var nativePoster=item.stream_icon||item.cover||item.cover_big;
 if(hasPoster(nativePoster)){poster.src=nativePoster;poster.style.display='block';}
 modal.style.display='block';
 document.getElementById('tv-metadata-watch').onclick=function(){modal.style.display='none';if(typeof play==='function')play();};
 document.getElementById('tv-metadata-close').onclick=function(){modal.style.display='none';};
 lookup(item,type,function(meta){
  if(modal.style.display==='none'||title.textContent!==name||!meta)return;
  summary.textContent=String(meta.overview||'Açıklama bulunamadı.');
  var cast=[],genres=meta.genres||[];for(var i=0;i<(meta.cast||[]).length&&i<5;i++)cast.push(meta.cast[i].name);
  facts.textContent=(meta.releaseDate||'')+'  ★ '+(meta.rating||'—')+'  '+(meta.runtimeMinutes?meta.runtimeMinutes+' dk  ':'')+
  (genres.length?genres.join(', ')+'  ':'')+(cast.length?'Oyuncular: '+cast.join(', '):'');
  if(hasPoster(meta.poster)){poster.src=meta.poster;poster.style.display='block';}
  var available=window.XIPTVTVHome&&window.XIPTVTVHome.data?window.XIPTVTVHome.data.movies||[]:[];
  function addVideo(choice,label){if(window.XIPTVTV&&window.XIPTVTV.canShowItem&&!window.XIPTVTV.canShowItem('movie',choice))return;var b=document.createElement('button');b.textContent=label;b.onclick=function(){modal.style.display='none';window.XIPTVTV.openSection('movie');window.XIPTVTV.openItem('movie',choice);};related.appendChild(b);}
  var similar=0;for(var k=0;k<available.length&&similar<6;k++){var sameCategory=String(available[k].category_id)===String(item.category_id)&&String(available[k].stream_id)!==String(item.stream_id);if(sameCategory){addVideo(available[k],'Aynı kategoriden: '+String(available[k].name||''));similar++;}}
  if(meta.collection&&meta.collection.id&&type!=='series'){collectionButton.style.display='inline-block';collectionButton.textContent='Serinin filmleri';collectionButton.onclick=function(){collectionButton.disabled=true;collectionParts(meta.collection.id,function(info){collectionButton.disabled=false;if(!info||!info.parts){related.textContent='Film serisi bilgisi alınamadı.';return;}related.textContent='';var count=0;for(var i=0;i<info.parts.length;i++){var titleKey=normalizedTitle(info.parts[i].title);for(var j=0;j<available.length;j++){if(normalizedTitle(available[j].name)===titleKey&&count<20){addVideo(available[j],String(info.parts[i].releaseDate||'')+' · '+String(info.parts[i].title));count++;break;}}}if(!count)related.textContent='Bu serinin diğer filmleri IPTV kataloğunda bulunamadı.';});};}
  if((meta.cast||[]).length){actors.style.display='inline-block';actors.innerHTML='';var option=document.createElement('option');option.text='Oyuncuya göre keşfet';option.value='';actors.appendChild(option);for(var ac=0;ac<meta.cast.length&&ac<12;ac++){var opt=document.createElement('option');opt.value=meta.cast[ac].name;opt.text=meta.cast[ac].name;actors.appendChild(opt);}actors.onchange=function(){var wanted=String(this.value||'').toLowerCase(),count=0;related.textContent='';if(!wanted)return;for(var c=0;c<available.length&&count<12;c++){var castText=String(available[c].cast||available[c].actors||'').toLowerCase();if(castText.indexOf(wanted)>=0&&String(available[c].stream_id)!==String(item.stream_id)){addVideo(available[c],String(available[c].name||'Film'));count++;}}if(!count)related.textContent='Bu oyuncuya ait başka yapım, sağlayıcının oyuncu verilerinde bulunamadı.';};}
 });
 document.getElementById('tv-metadata-watch').focus();
}
function knownAge(item,type){
 var entry=ages[itemKey(item,type)],now=new Date().getTime();
 return entry&&entry.until>now&&entry.confident?entry.age:null;
}
function checkAge(items,type,done){
 var pendingItems=[],today=new Date().getTime(),i,entry,key,results=[];
 for(i=0;i<items.length;i++){key=itemKey(items[i],type);entry=ages[key];if(!entry||entry.until<=today)pendingItems.push({id:key,title:String(items[i].name||items[i].title||''),type:type,year:Number(items[i].year)||undefined});}
 if(!pendingItems.length){if(done)done();return;}
 // Strictly bounded request: unknown/unavailable certifications never grant access.
 pendingItems=pendingItems.slice(0,12);
 var xhr=new XMLHttpRequest();xhr.open('POST',BASE+'/api/tmdb/age-check',true);xhr.timeout=25000;xhr.setRequestHeader('Content-Type','application/json');
 xhr.onload=function(){if(xhr.status>=200&&xhr.status<300){var result=parse(xhr).results||[];for(var j=0;j<result.length;j++){var r=result[j];if(r&&r.id)ages[r.id]={age:r.minimumAge,confident:r.confident===true&&typeof r.minimumAge==='number',until:today+86400000};}save(AGE_KEY,ages);}if(done)done();};
 xhr.onerror=function(){if(done)done();};xhr.ontimeout=function(){if(done)done();};
 try{xhr.send(JSON.stringify({items:pendingItems}));}catch(e){if(done)done();}
}
window.XIPTVMetadata={lookup:lookup,usePoster:usePoster,showDetails:showDetails,knownAge:knownAge,checkAge:checkAge,itemKey:itemKey};
})();