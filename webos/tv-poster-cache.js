/* webOS 2 persistent poster cache. ES5. Best effort: bounded IndexedDB blobs; never block playback. */
(function(){
 var DB='xiptv-poster-cache-v1', STORE='covers', MAX_BYTES=15*1024*1024, MAX_ITEMS=300;
 var db=null,available=false,queue=[],busy=0,failed={},seen={},urls={},inflight={},stats={hits:0,misses:0,saved:0,errors:0,bytes:0,items:0};
 var api={};window.XIPTVPosterCache=api;
 function report(){var el=document.getElementById('tv-cache-diagnostics');if(el)el.textContent='Poster önbelleği: '+(available?'açık':'desteklenmiyor')+' | '+stats.items+' poster, '+Math.round(stats.bytes/1048576*10)/10+' MB / 15 MB | İsabet: '+stats.hits+' | İndirme: '+stats.saved+' | Hata: '+stats.errors;}
 function release(image){if(image._xiptvBlobUrl){try{window.URL.revokeObjectURL(image._xiptvBlobUrl);}catch(e){}image._xiptvBlobUrl=null;}}
 function network(image,url){if(image.getAttribute('data-cache-original')!==url)return;release(image);image.src=url;}
 function transaction(mode,fn){if(!db)return;try{var t=db.transaction([STORE],mode);fn(t.objectStore(STORE));}catch(e){stats.errors++;report();}}
 function refreshStats(done){
  if(!db){if(done)done();return;}
  var c=0,n=0;transaction('readonly',function(store){var req=store.openCursor();req.onsuccess=function(ev){var cur=ev.target.result;if(cur){n++;c+=Number(cur.value.size||0);cur.continue();}else{stats.items=n;stats.bytes=c;report();if(done)done();}};req.onerror=function(){if(done)done();};});
 }
 function makeRoom(extra){
  if(!db)return;
  transaction('readwrite',function(store){
   var r=store.openCursor(),list=[],bytes=0;
   r.onsuccess=function(e){var c=e.target.result;if(c){bytes+=Number(c.value.size||0);list.push({key:c.key,size:Number(c.value.size||0),used:Number(c.value.used||0)});c.continue();return;}
    list.sort(function(a,b){return a.used-b.used;});var count=list.length;
    for(var i=0;i<list.length&&(bytes+extra>MAX_BYTES||count>=MAX_ITEMS);i++){store.delete(list[i].key);bytes-=list[i].size;count--;}
    stats.bytes=bytes;stats.items=count;report();
   };
  });
 }
 function save(url,blob){
  if(!db||!blob||!blob.size||blob.size>300*1024)return;
  makeRoom(blob.size);
  transaction('readwrite',function(store){var req=store.put({url:url,blob:blob,size:blob.size,used:new Date().getTime()});req.onsuccess=function(){stats.saved++;stats.items++;stats.bytes+=blob.size;report();};req.onerror=function(){stats.errors++;report();};});
 }
 function fetchNext(){
  if(!available||!db)return;
  while(busy<1&&queue.length){
   var url=queue.shift();if(failed[url])continue;
   busy++;(function(address){
    var xhr=new XMLHttpRequest(),completed=false;
    function finish(ok){if(completed)return;completed=true;busy--;delete inflight[address];if(!ok){failed[address]=true;stats.errors++;}report();setTimeout(fetchNext,200);}
    try{xhr.open('GET',address,true);xhr.responseType='blob';xhr.timeout=14000;
    xhr.onload=function(){var b=xhr.response;if(xhr.status>=200&&xhr.status<300&&b&&b.size&&b.size<=300*1024){save(address,b);finish(true);}else finish(false);};
    xhr.onerror=function(){finish(false);};xhr.ontimeout=function(){finish(false);};xhr.send();
    }catch(e){finish(false);}
   })(url);
  }
 }
 function enqueue(url){
  if(!available||!url||failed[url]||inflight[url]||seen[url]||queue.length>80)return;
  seen[url]=true;inflight[url]=true;queue.push(url);setTimeout(fetchNext,1000);
 }
 api.attach=function(image,url){
  if(!image||!/^https?:\/\//i.test(String(url||'')))return;
  url=String(url);image.setAttribute('data-cache-original',url);
  if(!available||!db){network(image,url);return;}
  transaction('readonly',function(store){
   var req=store.get(url);req.onsuccess=function(){
    if(image.getAttribute('data-cache-original')!==url)return;
    var record=req.result;
    if(record&&record.blob&&window.URL&&window.URL.createObjectURL){
     stats.hits++;try{release(image);var local=window.URL.createObjectURL(record.blob);image._xiptvBlobUrl=local;image.src=local;}catch(e){network(image,url);}
    }else{stats.misses++;network(image,url);enqueue(url);}
    report();
   };
   req.onerror=function(){network(image,url);enqueue(url);};
  });
 };
 api.status=function(){return {supported:available,items:stats.items,bytes:stats.bytes,hits:stats.hits,saved:stats.saved,errors:stats.errors};};
 api.clear=function(){
  if(!db)return;transaction('readwrite',function(store){store.clear();stats.bytes=0;stats.items=0;stats.saved=0;report();});
 };
 if(!window.indexedDB){report();return;}
 try{
  var request=window.indexedDB.open(DB,1);
  request.onupgradeneeded=function(e){var database=e.target.result;if(!database.objectStoreNames.contains(STORE))database.createObjectStore(STORE,{keyPath:'url'});};
  request.onsuccess=function(e){db=e.target.result;available=true;refreshStats();fetchNext();};
  request.onerror=function(){available=false;report();};
 }catch(e){available=false;report();}
})();
