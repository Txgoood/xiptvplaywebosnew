/* webOS 2 lightweight posters: no persistent disk writes. ES5 compatible. */
(function(){
 var stats={hits:0,misses:0,saved:0,errors:0,items:0,bytes:0};
 function report(){var el=document.getElementById('tv-cache-diagnostics');if(el)el.textContent='Poster depolama: kapalı (0 MB). Görseller yalnızca ihtiyaç halinde yükleniyor; TV hafızası korunuyor.';}
 function attach(image,url){
  if(!image||!/^https?:\/\//i.test(String(url||'')))return;
  image.setAttribute('data-cache-original',url);
  // WebKit may maintain its own temporary HTTP/image cache during the session.
  // Do not use IndexedDB, base64, Blob, localStorage or persistent data writes.
  image.src=url;stats.misses++;
 }
 window.XIPTVPosterCache={
  attach:attach,clear:function(){report();},
  status:function(){return {supported:false,items:0,bytes:0,hits:stats.hits,saved:0,errors:stats.errors};}
 };
 // Clear any experimental persistent poster database from previous test builds.
 try{if(window.indexedDB&&window.indexedDB.deleteDatabase)window.indexedDB.deleteDatabase('xiptv-poster-cache-v1');}catch(e){}
 report();
})();
