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
var SIZE_KEY='xiptv_webos2_poster_size_v1',ORDER_KEY='xiptv_webos2_shelf_order_v1';
function savedValue(k,f){try{return localStorage.getItem(k)||f;}catch(e){return f;}}
function saveValue(k,v){try{localStorage.setItem(k,v);}catch(e){}}
var posterSize=savedValue(SIZE_KEY,'large');
function applyPosterSize(){home.className=home.className.replace(/\btv-poster-size-(small|medium|large)\b/g,'').replace(/^\s+|\s+$/g,'')+' tv-poster-size-'+posterSize;}
function shelfPairs(){var rows=home.querySelectorAll('.stitch-tiles'),out=[];for(var i=0;i<rows.length;i++){var heading=rows[i].previousElementSibling;if(heading&&heading.className.indexOf('stitch-heading')>=0)out.push({id:rows[i].id,heading:heading,row:rows[i]});}return out;}
function applyShelfOrder(){var pairs=shelfPairs(),saved=[];try{saved=JSON.parse(savedValue(ORDER_KEY,'[]'));}catch(e){}if(!saved||!saved.length)return;var mapped={};for(var i=0;i<pairs.length;i++)mapped[pairs[i].id]=pairs[i];var ordered=[];for(i=0;i<saved.length;i++)if(mapped[saved[i]]){ordered.push(mapped[saved[i]]);delete mapped[saved[i]];}for(i=0;i<pairs.length;i++)if(mapped[pairs[i].id]){ordered.push(pairs[i]);delete mapped[pairs[i].id];}if(!ordered.length)return;var parent=ordered[0].heading.parentNode,footer=home.querySelector('.stitch-footer');for(i=0;i<ordered.length;i++){parent.insertBefore(ordered[i].heading,footer);parent.insertBefore(ordered[i].row,footer);}}
function renderShelfControls(){var box=document.getElementById('tv-home-shelf-order');if(!box)return;clear(box);var pairs=shelfPairs();for(var i=0;i<pairs.length;i++){(function(pos,pair){var line=document.createElement('div');line.className='tv-shelf-order-row';var label=document.createElement('span');label.textContent=pair.heading.getElementsByTagName('strong')[0].textContent;line.appendChild(label);function move(delta){var next=pos+delta;if(next<0||next>=pairs.length)return;var order=pairs.map(function(x){return x.id;});var hold=order[next];order[next]=order[pos];order[pos]=hold;saveValue(ORDER_KEY,JSON.stringify(order));applyShelfOrder();renderShelfControls();}var up=document.createElement('button');up.textContent='▲';up.title='Rafı yukarı taşı';up.onclick=function(){move(-1);};line.appendChild(up);var down=document.createElement('button');down.textContent='▼';down.title='Rafı aşağı taşı';down.onclick=function(){move(1);};line.appendChild(down);box.appendChild(line);})(i,pairs[i]);}}
applyPosterSize();applyShelfOrder();
var sizeControl=document.getElementById('tv-home-poster-size');if(sizeControl){sizeControl.value=posterSize;sizeControl.onchange=function(){posterSize=this.value;saveValue(SIZE_KEY,posterSize);applyPosterSize();};}
renderShelfControls();
function decorateProgress(button,mode,item){
 if(!window.XIPTVTV||!window.XIPTVTV.getMediaProgress)return;
 var progress=window.XIPTVTV.getMediaProgress(mode,item);
 if(progress.watched){var tag=document.createElement('strong');tag.className='tv-watched-tag';tag.textContent='✓ İzlendi';button.appendChild(tag);return;}
 if(progress.percent<=0||progress.percent>=100)return;
 var track=document.createElement('span');track.className='tv-poster-progress';var bar=document.createElement('i');bar.style.width=progress.percent+'%';track.appendChild(bar);button.appendChild(track);
 var tag=document.createElement('strong');tag.className='tv-progress-tag';tag.textContent=progress.percent+'% izlendi';button.appendChild(tag);
}
var ageLookupStarted=false;
function shelf(node,items,type,limit){
 clear(node);
 if(!items.length){var empty=document.createElement('div');empty.className='stitch-empty';empty.textContent=(window.XIPTVTV&&window.XIPTVTV.isChildProfile&&window.XIPTVTV.isChildProfile())?'Ebeveyn onaylı içerik bulunamadı. Yetişkin profilinden Çocuğa izin ver seçeneğini kullanın.':'Henüz içerik bulunamadı.';node.appendChild(empty);return;}
 for(var n=0;n<items.length&&n<limit;n++){(function(item){
  var b=document.createElement('button');b.type='button';b.className='stitch-movie-tile';
  b.setAttribute('aria-label',String(item.name||item.title||'İçerik'));
  b._xiptvItem=item;b._xiptvType=type;
  var cover=String(item.stream_icon||item.cover_big||item.cover||'');
  if(type!=='live'){
   var img=document.createElement('img');img.alt='';if(/^https?:\/\//i.test(cover))img.src=cover;else img.style.display='none';
   if(window.XIPTVMetadata)window.XIPTVMetadata.usePoster(img,item,type==='films'?'movie':'series');
   else img.onerror=function(){this.style.display='none';};b.appendChild(img);
  }else if(/^https?:\/\//i.test(cover)){var img=document.createElement('img');img.src=cover;img.alt='';img.onerror=function(){this.style.display='none';};b.appendChild(img);}
  var title=document.createElement('span');title.textContent=String(item.name||item.title||'İçerik');b.appendChild(title);
  if(type==='films'||type==='series')decorateProgress(b,type==='films'?'movie':'series',item);
  if(type==='series'&&window.XIPTVTV&&window.XIPTVTV.getNewEpisodeCount&&window.XIPTVTV.getNewEpisodeCount(item.series_id)>0){var newTag=document.createElement('strong');newTag.className='tv-new-episode-tag';newTag.textContent='Yeni bölüm +'+window.XIPTVTV.getNewEpisodeCount(item.series_id);b.appendChild(newTag);}
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
 var ageYoung=[],ageOlder=[],c;
 if(window.XIPTVMetadata){
  for(c=0;c<familyMovies.length;c++){
   var verified=window.XIPTVMetadata.knownAge(familyMovies[c],'movie');
   if(verified!==null&&verified<=9)ageYoung.push(familyMovies[c]);
   if(verified!==null&&verified<=12)ageOlder.push(familyMovies[c]);
  }
  // Until certification succeeds, the family row fails closed rather than show adult films.
  familyMovies=ageOlder.slice(0);
  if(!ageLookupStarted&&movies.length>30){
   ageLookupStarted=true;
   var candidates=recommendations(movies,catalog.vodCategories,/family|aile|animasyon|animation|çocuk|cocuk|kids|disney|pixar/i,12,true);
   setTimeout(function(){window.XIPTVMetadata.checkAge(candidates,'movie',function(){if(window.XIPTVTVHome)window.XIPTVTVHome.refresh();});},2000);
  }
 }
 var childShows=recommendations(series,catalog.seriesCategories,/çocuk|cocuk|kids|animasyon|animation|cartoon|family|aile|çizgi|cizgi/i,12,true);
 // Child mode uses an explicit allowlist, never category labels as age certification.
 if(child&&window.XIPTVTV&&window.XIPTVTV.isChildApproved){
  function approvedOnly(items,mode){var out=[];for(var i=0;i<items.length;i++)if(window.XIPTVTV.isChildApproved(mode,items[i]))out.push(items[i]);return out;}
  childMovies=approvedOnly(movies,'movie');childShows=approvedOnly(series,'series');familyMovies=approvedOnly(familyMovies,'movie');
 }
 shelf(document.getElementById('stitch-kids-movies'),childMovies,'films',12);
 shelf(document.getElementById('stitch-age-6-9'),child?ageYoung.filter(function(x){return window.XIPTVTV.isChildApproved('movie',x);}):ageYoung,'films',12);
 shelf(document.getElementById('stitch-age-10-12'),child?ageOlder.filter(function(x){return window.XIPTVTV.isChildApproved('movie',x);}):ageOlder,'films',12);
 shelf(document.getElementById('stitch-family'),familyMovies,'films',12);
 shelf(document.getElementById('stitch-kids-series'),childShows,'series',12);
 shelf(document.getElementById('stitch-recent'),child?childMovies:movies,'films',9);
 var favorites=[],recent=[];
 var childChannels=child?channels.filter(function(item){return window.XIPTVTV&&window.XIPTVTV.isChildApproved&&window.XIPTVTV.isChildApproved('live',item);}):channels;
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
  decorateProgress(b,record.type==='films'?'movie':'series',record.item);
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
var kidShortcut=document.getElementById('tv-kids-shortcut');if(kidShortcut)kidShortcut.onclick=function(){open('live');};
document.getElementById('tv-home-films').onclick=function(){open('films');};
document.getElementById('tv-home-series').onclick=function(){open('series');};
document.getElementById('tv-feature-play').onclick=function(){open('films');var d=window.XIPTVTVHome.data;if(d&&d.movies.length)window.XIPTVTV.openItem('movie',d.movies[0]);};
document.getElementById('tv-feature-detail').onclick=function(){var d=window.XIPTVTVHome.data,items=d&&d.movies;if(!items||!items.length||!window.XIPTVMetadata){open('films');return;}var item=items[0];window.XIPTVMetadata.showDetails(item,'movie',function(){open('films');window.XIPTVTV.openItem('movie',item);});};
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
var helpPanel=document.getElementById('tv-remote-help');
document.getElementById('tv-settings-help').onclick=function(){settings(false);helpPanel.style.display='block';document.getElementById('tv-remote-help-close').focus();};
document.getElementById('tv-remote-help-close').onclick=function(){helpPanel.style.display='none';document.getElementById('tv-nav-home').focus();};
document.getElementById('tv-settings-player').onclick=function(){settings(false);open('live');var tools=document.getElementById('tv-player-settings');if(tools)tools.click();else document.getElementById('tv-controls-toggle').click();};
document.getElementById('tv-settings-profiles').onclick=function(){settings(false);open('live');document.getElementById('tv-profile-switch').click();};
document.getElementById('tv-settings-connection').onclick=function(){settings(false);open('live');document.getElementById('iptv-login').style.display='block';document.getElementById('iptv-browser').style.display='none';};
document.getElementById('tv-settings-diagnostics').onclick=function(){settings(false);document.getElementById('tv-show-diagnostics').click();};
document.getElementById('tv-show-diagnostics').onclick=function(){diag.style.display='block';home.style.display='none';document.getElementById('system').focus();};
document.getElementById('iptv-hide').addEventListener('click',function(){home.style.display='block';document.body.className='';document.getElementById('tv-nav-home').focus();},false);
function posterRows(){return document.querySelectorAll('#tv-home .stitch-tiles');}
function rowButtons(row){return row.querySelectorAll('.stitch-movie-tile');}
function revealPoster(button){
 if(!button)return;
 var row=button.parentNode,visibleLeft=row.scrollLeft,visibleRight=visibleLeft+row.clientWidth;
 var left=button.getBoundingClientRect().left-row.getBoundingClientRect().left+row.scrollLeft, right=left+button.offsetWidth;
 if(left<visibleLeft)row.scrollLeft=Math.max(0,left-12);
 else if(right>visibleRight)row.scrollLeft=right-row.clientWidth+12;
 // Keep the selected category visible without relying on smooth-scrolling support.
 var viewport=document.querySelector('#tv-home .stitch-scroll'), top=row.offsetTop;
 if(viewport){var parent=row.offsetParent;while(parent&&parent!==viewport){top+=parent.offsetTop;parent=parent.offsetParent;}
  if(top<viewport.scrollTop+45)viewport.scrollTop=Math.max(0,top-56);
  else if(top+row.offsetHeight>viewport.scrollTop+viewport.clientHeight-18)viewport.scrollTop=top+row.offsetHeight-viewport.clientHeight+24;
 }
}
function firstPoster(){var rows=posterRows();for(var i=0;i<rows.length;i++){var buttons=rowButtons(rows[i]);if(buttons.length){buttons[0].focus();revealPoster(buttons[0]);return true;}}return false;}
document.addEventListener('keydown',function(e){
 if(document.getElementById('tv-settings-panel').style.display!=='none')return;
 if(helpPanel.style.display!=='none'){if(e.keyCode===461||e.keyCode===27||e.keyCode===13){helpPanel.style.display='none';document.getElementById('tv-nav-home').focus();e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();}return;}
 if(home.style.display==='none')return;
 var k=e.keyCode||e.which;
 if(k===457&&document.activeElement&&document.activeElement._xiptvItem&&window.XIPTVMetadata){
  var tile=document.activeElement,item=tile._xiptvItem,type=tile._xiptvType;
  window.XIPTVMetadata.showDetails(item,type==='films'?'movie':type==='series'?'series':'movie',function(){open(type==='films'?'films':type==='series'?'series':'live');window.XIPTVTV.openItem(type==='films'?'movie':type==='series'?'series':'live',item);});
  e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();return;
 }
 if(k!==37&&k!==38&&k!==39&&k!==40&&k!==13)return;
 var active=document.activeElement,rows=posterRows(),rowIndex=-1,col=-1,r,j,buttons;
 for(r=0;r<rows.length;r++){buttons=rowButtons(rows[r]);for(j=0;j<buttons.length;j++)if(buttons[j]===active){rowIndex=r;col=j;break;}if(rowIndex>=0)break;}
 if(rowIndex>=0){
  if(k===13)active.click();
  else if(k===37&&col===0){document.getElementById('tv-nav-home').focus();}
  else if(k===37||k===39){
   buttons=rowButtons(rows[rowIndex]);var next=col+(k===37?-1:1);
   if(next>=0&&next<buttons.length){buttons[next].focus();revealPoster(buttons[next]);}
  }else{
   var nextRow=rowIndex+(k===38?-1:1),step=k===38?-1:1;
   while(nextRow>=0&&nextRow<rows.length&&!rowButtons(rows[nextRow]).length)nextRow+=step;
   if(nextRow>=0&&nextRow<rows.length){buttons=rowButtons(rows[nextRow]);var chosen=buttons[Math.min(col,buttons.length-1)];chosen.focus();revealPoster(chosen);}
   else if(k===38)document.getElementById('tv-feature-play').focus();
  }
  e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();return;
 }
 if(k===40&&(active===document.getElementById('tv-feature-play')||active===document.getElementById('tv-feature-detail'))){
  if(firstPoster()){e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();return;}
 }
 // Right from the navigation sidebar enters the poster shelves immediately.
 if(k===39&&active&&active.parentNode===side){if(firstPoster()){e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();return;}}
 var current=0;for(var p=0;p<nodes.length;p++)if(nodes[p]===document.activeElement)current=p;
 if(k===13)nodes[current].click();
 else{var delta=(k===37||k===38)?-1:1;nodes[(current+delta+nodes.length)%nodes.length].focus();}
 e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();
},true);
document.getElementById('tv-nav-home').focus();
})();
