/* Shared image fallback for webOS 2. Never render an empty thumbnail. */
(function(){
 function candidates(item){
  var keys=['stream_icon','cover_big','cover','movie_image','poster','poster_path','image','icon','backdrop_path'],out=[],seen={};
  for(var i=0;i<keys.length;i++){
   var value=item&&item[keys[i]];
   if(value&&typeof value==='object'&&value.length)value=value[0];
   value=String(value||'').replace(/^\s+|\s+$/g,'');
   if(!value||value==='null'||value==='undefined')continue;
   if(value.indexOf('//')===0)value='https:'+value;
   if(value.charAt(0)==='/'&&value.indexOf('//')!==0)value='https://image.tmdb.org/t/p/w500'+value;
   if(!/^https?:\/\//i.test(value))continue;
   if(!seen[value]){seen[value]=true;out.push(value);}
  }
  return out;
 }
 function attach(parent,item,kind){
  var sources=candidates(item),img=document.createElement('img'),index=0;
  var placeholder=document.createElement('span');
  placeholder.className='tv-poster-placeholder';
  placeholder.textContent=kind==='live'?'CANLI TV':kind==='series'?'DİZİ':'FİLM';
  parent.appendChild(placeholder);
  if(!sources.length)return;
  img.alt='';
  img.onerror=function(){
   index++;
   if(index<sources.length){this.src=sources[index];return;}
   this.style.display='none';
   placeholder.style.display='block';
  };
  img.onload=function(){placeholder.style.display='none';this.style.display='block';};
  img.src=sources[0];
  parent.appendChild(img);
 }
 window.XIPTVPoster={attach:attach,candidates:candidates};
})();