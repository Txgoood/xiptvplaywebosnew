/* Performance diagnostics for webOS 2 / WebKit 538. ES5 and read-only monitoring. */
(function(){
 var values={},maxSamples=20,boot=new Date().getTime(),lastRemote=0;
 function update(){
  var el=document.getElementById('tv-performance-diagnostics');if(!el)return;
  var parts=[],names=['Kumanda tepki','Katalog filtreleme','Liste çizimi','Katalog yükleme','İlk ekran'];
  for(var i=0;i<names.length;i++){var item=values[names[i]];if(item&&item.samples.length){var sum=0;for(var j=0;j<item.samples.length;j++)sum+=item.samples[j];parts.push(names[i]+': '+Math.round(sum/item.samples.length)+' ms (en yüksek '+item.max+' ms)');}}
  el.textContent=parts.length?parts.join(' | '):'İşlemler ölçülüyor; kumandada birkaç kez gezin.';
 }
 function measure(name,ms){ms=Number(ms);if(!isFinite(ms)||ms<0)return;var v=values[name]||(values[name]={samples:[],max:0});v.samples.push(ms);if(v.samples.length>maxSamples)v.samples.shift();v.max=Math.max(v.max,ms);update();}
 window.XIPTVPerformance={measure:measure,boot:boot,report:update};
 document.addEventListener('keydown',function(e){
  var k=e.keyCode||e.which;
  if(k!==37&&k!==38&&k!==39&&k!==40&&k!==13)return;
  var started=new Date().getTime();if(started-lastRemote<50)return;lastRemote=started;
  if(window.requestAnimationFrame)window.requestAnimationFrame(function(){measure('Kumanda tepki',new Date().getTime()-started);});
  else setTimeout(function(){measure('Kumanda tepki',new Date().getTime()-started);},0);
 },true);
 var clear=document.getElementById('tv-clear-poster-cache');
 if(clear)clear.onclick=function(){if(window.XIPTVPosterCache&&window.XIPTVPosterCache.clear)window.XIPTVPosterCache.clear();};
 update();
})();
