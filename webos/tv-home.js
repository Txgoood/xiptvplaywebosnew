/* XIPTV Play TV: Stitch-inspired home, ES5 / webOS 2 compatible. */
(function(){
var home=document.getElementById('tv-home'),diag=document.getElementById('tv-diagnostics');
/* Keep Stitch navigation visible in every catalog view, not just launcher. */
var side=document.getElementById('stitch-side');home.parentNode.insertBefore(side,home);
/* Drawer must live outside hidden IPTV panel to work on home. */
var favoritesPanel=document.getElementById('tv-favorites-panel');
home.parentNode.insertBefore(favoritesPanel,home);
var settingsPanel=document.getElementById('tv-settings-panel');
home.parentNode.insertBefore(settingsPanel,home);
var ids=['tv-nav-home','tv-home-live','tv-home-films','tv-home-series','tv-nav-fav','tv-nav-search','tv-nav-profile','tv-nav-settings','tv-feature-play','tv-feature-detail','tv-show-diagnostics'];
var nodes=[],i;for(i=0;i<ids.length;i++)nodes.push(document.getElementById(ids[i]));
function markActive(id){var all=['tv-nav-home','tv-home-live','tv-home-films','tv-home-series','tv-nav-fav','tv-nav-search','tv-nav-profile','tv-nav-settings'];for(var j=0;j<all.length;j++)document.getElementById(all[j]).className=all[j]===id?'selected':'';}
function open(section){
 favoritesPanel.style.display='none';
 markActive(section==='films'?'tv-home-films':section==='series'?'tv-home-series':'tv-home-live');
 home.style.display='none';
 document.body.className='tv-mode tv-catalog';
 window.XIPTVTV.startMode=section==='films'?'movie':section==='series'?'series':'live';
 document.getElementById('tv-favorite-only').checked=false;
 document.getElementById('tv-search').value='';
 document.getElementById('tv-search-scope').value='all';
 window.XIPTVTV.openSection(window.XIPTVTV.startMode);
}
function clear(node){while(node.firstChild)node.removeChild(node.firstChild);}
function shelf(node,items,type,limit){
 clear(node);
 if(!items.length){var empty=document.createElement('div');empty.className='stitch-empty';empty.textContent='Henüz içerik bulunamadı.';node.appendChild(empty);return;}
 for(var n=0;n<items.length&&n<limit;n++){(function(item){
  var b=document.createElement('button');b.type='button';b.className='stitch-movie-tile';
  var cover=String(item.stream_icon||item.cover_big||item.cover||'');
  if(/^https?:\/\//i.test(cover)){var img=document.createElement('img');img.src=cover;img.alt='';img.onerror=function(){this.style.display='none';};b.appendChild(img);}
  var title=document.createElement('span');title.textContent=String(item.name||item.title||'İçerik');b.appendChild(title);
  b.onclick=function(){open(type==='films'?'films':type==='series'?'series':'live');window.XIPTVTV.openItem(type==='films'?'movie':type==='series'?'series':'live',item);};
  node.appendChild(b);
 })(items[n]);}
}
// Suggestions use only the user's IPTV catalogue; a title/category match is not an age rating.
function safeText(v){return String(v||'').toLowerCase().replace(/[İI]/g,'i');}
function categoryMap(cats){var out={},i;for(i=0;i<(cats||[]).length;i++)out[String(cats[i].category_id)]=String(cats[i].category_name||'');return out;}
function recommendations(items,categories,pattern,limit,strict){
 var result=[],seen={},map=categoryMap(categories),i,item,key,name,cat,text;
 for(i=0;i<items.length&&result.length<limit;i++){
  item=items[i];name=safeText(item.name||item.title);cat=safeText(map[String(item.category_id)]||'');
  text=name+' '+cat;
  if(/xxx|adult|erotik|porno|18\+|yetişkin|horror|korku|gerilim|şiddet/i.test(text))continue;
  if(strict&&!/çocuk|cocuk|kids|kid|animation|animasyon|cartoon|çizgi|cizgi|family|aile|disney|pixar/i.test(cat))continue;
  if(!pattern.test(text))continue;
  key=String(item.stream_id||item.series_id||item.id||name);
  if(seen[key])continue;seen[key]=true;result.push(item);
 }
 return result;
}
function previewItem(item){
 return {name:item.name||item.title||'',stream_id:item.stream_id,series_id:item.series_id,category_id:item.category_id,
   container_extension:item.container_extension,stream_icon:item.stream_icon||'',cover:item.cover||'',cover_big:item.cover_big||''};
}
function limitedPreview(catalog){
 function compact(list,categories){
  var out=[],seen={},candidate=recommendations(list,categories,/çocuk|cocuk|kids|animasyon|animation|cartoon|family|aile|disney|pixar|çizgi|cizgi|nick|baby/i,24,true),i,item,key;
  for(i=0;i<list.length&&out.length<24;i++){item=list[i];key=String(item.stream_id||item.series_id||item.id);if(!seen[key]){seen[key]=true;out.push(previewItem(item));}}
  for(i=0;i<candidate.length&&out.length<48;i++){item=candidate[i];key=String(item.stream_id||item.series_id||item.id);if(!seen[key]){seen[key]=true;out.push(previewItem(item));}}
  return out;
 }
 function slimCategories(cats){var out=[];for(var i=0;i<(cats||[]).length&&i<400;i++)out.push({category_id:cats[i].category_id,category_name:cats[i].category_name});return out;}
 return {vodStreams:compact(catalog.vodStreams||[],catalog.vodCategories),seriesList:compact(catalog.seriesList||[],catalog.seriesCategories),
  liveStreams:compact(catalog.liveStreams||[],catalog.liveCategories),vodCategories:slimCategories(catalog.vodCategories),
  seriesCategories:slimCategories(catalog.seriesCategories),liveCategories:slimCategories(catalog.liveCategories)};
}
window.XIPTVTVHome={catalog:null,preview:limitedPreview,refresh:function(){if(this.catalog)this.render(this.catalog);},render:function(catalog){
 this.catalog=catalog;
 var movies=catalog.vodStreams||[],series=catalog.seriesList||[],channels=catalog.liveStreams||[];
 var child=!!(window.XIPTVTV&&window.XIPTVTV.isChildProfile&&window.XIPTVTV.isChildProfile());
 var childMovies=recommendations(movies,catalog.vodCategories,/çocuk|cocuk|kids|animasyon|animation|cartoon|family|aile|disney|pixar|çizgi|cizgi/i,12,true);
 var familyMovies=recommendations(movies,catalog.vodCategories,/family|aile|animasyon|animation|çocuk|cocuk|kids|disney|pixar/i,12,true);
 var childShows=recommendations(series,catalog.seriesCategories,/çocuk|cocuk|kids|animasyon|animation|cartoon|family|aile|çizgi|cizgi/i,12,true);
 shelf(document.getElementById('stitch-kids-movies'),childMovies,'films',12);
 shelf(document.getElementById('stitch-family'),familyMovies,'films',12);
 shelf(document.getElementById('stitch-kids-series'),childShows,'series',12);
 shelf(document.getElementById('stitch-recent'),child?childMovies:movies,'films',9);
 var favorites=[],recent=[];
 var childChannels=child?recommendations(channels,catalog.liveCategories,/çocuk|cocuk|kids|cartoon|çizgi|cizgi|disney|nick|baby/i,30,true):channels;
 for(var c=0;c<childChannels.length&&favorites.length<8;c++)if(window.XIPTVTV.isFavorite('live',childChannels[c]))favorites.push(childChannels[c]);
 shelf(document.getElementById('stitch-favorites'),favorites,'live',8);
 var resume=window.XIPTVTV.getResume(),continuing=[];
 var resumeMovies=child?childMovies:movies,resumeSeries=child?childShows:series;
 for(var r=0;r<resumeMovies.length&&continuing.length<8;r++)if(Number(resume['movie:'+String(resumeMovies[r].stream_id)]||0)>20)continuing.push({item:resumeMovies[r],type:'films'});
 for(var k=0;k<resumeSeries.length&&continuing.length<8;k++)if(Number(resume['series:'+String(resumeSeries[k].series_id)]||0)>20)continuing.push({item:resumeSeries[k],type:'series'});
 var node=document.getElementById('stitch-continue');clear(node);
 if(!continuing.length){var empty=document.createElement('div');empty.className='stitch-empty';empty.textContent='İzlemeye başladığın filmler ve diziler burada görünecek.';node.appendChild(empty);}
 for(var z=0;z<continuing.length;z++){(function(record){
  var b=document.createElement('button');b.type='button';b.className='stitch-movie-tile';
  var im=String(record.item.stream_icon||record.item.cover||'');
  if(/^https?:\/\//i.test(im)){var pic=document.createElement('img');pic.src=im;pic.alt='';pic.onerror=function(){this.style.display='none';};b.appendChild(pic);}
  var title=document.createElement('span');title.textContent=String(record.item.name||record.item.title||'İçerik');b.appendChild(title);
  b.onclick=function(){open(record.type);if(record.type==='series')window.XIPTVTV.resumeSeriesFromHome=true;window.XIPTVTV.openItem(record.type==='films'?'movie':'series',record.item);};
  node.appendChild(b);
 })(continuing[z]);}
 shelf(document.getElementById('stitch-series'),child?childShows:series,'series',8);
 shelf(document.getElementById('stitch-live'),child?childChannels:channels,'live',8);
 window.XIPTVTVHome.data={movies:child?childMovies:movies,series:child?childShows:series,channels:child?childChannels:channels};
 var lead=(child?childMovies:movies)[0];if(!lead)return;
 var cover=String(lead.stream_icon||lead.cover||'');
 var hero=document.getElementById('stitch-hero');
 if(/^https?:\/\//i.test(cover)){hero.style.backgroundImage='linear-gradient(90deg,#10151d 0%,rgba(16,21,29,.97) 28%,rgba(16,21,29,.55) 72%),url("'+cover.replace(/["'()\\]/g,'')+'")';}
 document.getElementById('stitch-feature-title').textContent=String(lead.name||'İçerikleri Keşfet');
 document.getElementById('stitch-feature-description').textContent='Film ve dizi koleksiyonun büyük ekranda. Kategorileri keşfet, oynatmaya başla.';
}};
document.getElementById('tv-nav-home').onclick=function(){favoritesPanel.style.display='none';markActive('tv-nav-home');window.XIPTVTVHome.refresh();document.getElementById('iptv-panel').style.display='none';document.body.className='';home.style.display='block';};
document.getElementById('tv-home-live').onclick=function(){open('live');};
document.getElementById('tv-home-films').onclick=function(){open('films');};
document.getElementById('tv-home-series').onclick=function(){open('series');};
document.getElementById('tv-feature-play').onclick=function(){open('films');var d=window.XIPTVTVHome.data;if(d&&d.movies.length)window.XIPTVTV.openItem('movie',d.movies[0]);};
document.getElementById('tv-feature-detail').onclick=function(){open('films');};
document.getElementById('tv-nav-fav').onclick=function(){var p=favoritesPanel;var show=p.style.display==='none';p.style.display=show?'block':'none';if(show){document.getElementById('tv-settings-panel').style.display='none';markActive('tv-nav-fav');}};
function favMode(mode){document.getElementById('tv-favorites-panel').style.display='none';open(mode==='movie'?'films':mode==='series'?'series':'live');document.getElementById('tv-favorite-only').checked=true;if(window.XIPTVTV.refresh)window.XIPTVTV.refresh();markActive('tv-nav-fav');}
document.getElementById('tv-fav-live').onclick=function(){favMode('live');};document.getElementById('tv-fav-movie').onclick=function(){favMode('movie');};document.getElementById('tv-fav-series').onclick=function(){favMode('series');};
document.getElementById('tv-nav-search').onclick=function(){open('films');document.getElementById('tv-search').click();};
document.getElementById('tv-nav-profile').onclick=function(){open('live');document.getElementById('tv-profile-switch').click();};
function settings(show){settingsPanel.style.display=show?'block':'none';if(show)document.getElementById('tv-settings-close').focus();}
document.getElementById('tv-nav-settings').onclick=function(){var p=document.getElementById('tv-settings-panel');settings(p.style.display==='none');document.getElementById('tv-favorites-panel').style.display='none';};
document.addEventListener('click',function(e){var p=document.getElementById('tv-settings-panel'),b=document.getElementById('tv-nav-settings');if(p.style.display!=='none'&&!p.contains(e.target)&&!b.contains(e.target))settings(false);var q=document.getElementById('tv-favorites-panel'),fb=document.getElementById('tv-nav-fav');if(q.style.display!=='none'&&!q.contains(e.target)&&!fb.contains(e.target))q.style.display='none';},false);
var FILTER_KEY='xiptv_webos2_category_filters_v1';
function syncFilters(){document.getElementById('tv-tr-only').checked=document.getElementById('tv-settings-tr').checked;document.getElementById('tv-hide-adult').checked=document.getElementById('tv-settings-adult').checked;try{localStorage.setItem(FILTER_KEY,JSON.stringify({tr:document.getElementById('tv-settings-tr').checked,adult:document.getElementById('tv-settings-adult').checked}));}catch(e){}if(window.XIPTVTV&&window.XIPTVTV.refreshCategories)window.XIPTVTV.refreshCategories();}
try{var savedFilters=JSON.parse(localStorage.getItem(FILTER_KEY)||'{}');document.getElementById('tv-settings-tr').checked=!!savedFilters.tr;document.getElementById('tv-settings-adult').checked=!!savedFilters.adult;document.getElementById('tv-tr-only').checked=!!savedFilters.tr;document.getElementById('tv-hide-adult').checked=!!savedFilters.adult;}catch(e){}
document.getElementById('tv-settings-tr').onchange=syncFilters;
document.getElementById('tv-settings-adult').onchange=syncFilters;
document.getElementById('tv-settings-close').onclick=function(){settings(false);document.getElementById('tv-nav-settings').focus();};
document.getElementById('tv-settings-player').onclick=function(){settings(false);open('live');document.getElementById('tv-controls-toggle').click();};
document.getElementById('tv-settings-profiles').onclick=function(){settings(false);open('live');document.getElementById('tv-profile-switch').click();};
document.getElementById('tv-settings-connection').onclick=function(){settings(false);open('live');document.getElementById('iptv-login').style.display='block';document.getElementById('iptv-browser').style.display='none';};
document.getElementById('tv-settings-diagnostics').onclick=function(){settings(false);document.getElementById('tv-show-diagnostics').click();};
document.getElementById('tv-show-diagnostics').onclick=function(){diag.style.display='block';home.style.display='none';document.getElementById('system').focus();};
document.getElementById('iptv-hide').addEventListener('click',function(){home.style.display='block';document.body.className='';document.getElementById('tv-nav-home').focus();},false);
document.addEventListener('keydown',function(e){
 if(document.getElementById('tv-settings-panel').style.display!=='none')return;
 if(home.style.display==='none')return;
 var k=e.keyCode||e.which;if(k!==37&&k!==38&&k!==39&&k!==40&&k!==13)return;
 var active=document.activeElement,tiles=document.querySelectorAll('#tv-home .stitch-movie-tile'),index=-1,t;
 for(t=0;t<tiles.length;t++)if(tiles[t]===active){index=t;break;}
 if(index>=0){
  if(k===13){active.click();}
  else {
   var target=index+(k===37?-1:k===39?1:0);
   if(k===38||k===40){
    var currentParent=active.parentNode,row=active.parentNode,rows=document.querySelectorAll('#tv-home .stitch-tiles'),rowIndex=-1,col=0,n;
    for(n=0;n<rows.length;n++)if(rows[n]===row)rowIndex=n;
    for(n=0;n<row.children.length;n++)if(row.children[n]===active){col=n;break;}
    var desired=rowIndex+(k===38?-1:1);
    while(desired>=0&&desired<rows.length&&!rows[desired].querySelector('.stitch-movie-tile'))desired+=(k===38?-1:1);
    if(desired>=0&&desired<rows.length){var options=rows[desired].querySelectorAll('.stitch-movie-tile');options[Math.min(col,options.length-1)].focus();}
    else if(k===38)document.getElementById('tv-feature-play').focus();
   }else if(target>=0&&target<tiles.length&&tiles[target].parentNode===active.parentNode){tiles[target].focus();}
  }
  try{document.activeElement.scrollIntoView(false);}catch(err){}
  e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();return;
 }
 if(k===40&&(active===document.getElementById('tv-feature-play')||active===document.getElementById('tv-feature-detail'))&&tiles.length){
  tiles[0].focus();try{tiles[0].scrollIntoView(false);}catch(err){}
  e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();return;
 }
 var current=0;for(var p=0;p<nodes.length;p++)if(nodes[p]===document.activeElement)current=p;
 if(k===13)nodes[current].click();
 else{var delta=(k===37||k===38)?-1:1;nodes[(current+delta+nodes.length)%nodes.length].focus();}
 e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();
},true);
document.getElementById('tv-nav-home').focus();
})();
