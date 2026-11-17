/* XIPTV Play webOS 2 - top navigation and compact category browsing. ES5 only. */
(function(){
var browser=document.getElementById('iptv-browser'),categories=document.getElementById('iptv-categories');
if(!browser||!categories)return;
var header=document.createElement('div');header.id='tv-catalog-header';browser.insertBefore(header,browser.firstChild);
var back=document.createElement('button');back.id='tv-catalog-back';back.type='button';back.textContent='⌂  ›  Kategoriler';
var current=document.createElement('strong');current.id='tv-catalog-current';current.textContent='Tüm Kategoriler';
header.appendChild(back);header.appendChild(current);
var toolbar=document.createElement('div');toolbar.id='tv-category-tools';
var prev=document.createElement('button');prev.type='button';prev.textContent='‹';prev.title='Önceki kategoriler';
var next=document.createElement('button');next.type='button';next.textContent='›';next.title='Sonraki kategoriler';
var openBtn=document.createElement('button');openBtn.type='button';openBtn.id='tv-category-open';openBtn.textContent='▦  Tüm Kategoriler';
toolbar.appendChild(prev);toolbar.appendChild(next);toolbar.appendChild(openBtn);
browser.insertBefore(toolbar,categories);
var drawer=document.createElement('div');drawer.id='tv-category-drawer';drawer.style.display='none';
var drawerHeading=document.createElement('div');drawerHeading.id='tv-category-drawer-heading';
var drawerTitle=document.createElement('strong');drawerTitle.textContent='Kategoriler';
var drawerClose=document.createElement('button');drawerClose.type='button';drawerClose.textContent='Kapat ✕';
drawerHeading.appendChild(drawerTitle);drawerHeading.appendChild(drawerClose);
var drawerItems=document.createElement('div');drawerItems.id='tv-category-drawer-items';drawer.appendChild(drawerHeading);drawer.appendChild(drawerItems);
document.body.appendChild(drawer);
var previousFocus=null,active='all',currentMode='live',playingFocus=null,playingScroll=0,drawerDirty=true,seriesPoster=null;
function closeDrawer(){drawer.style.display='none';if(previousFocus&&previousFocus.focus)previousFocus.focus();}
function openDrawer(){
 previousFocus=document.activeElement;
 if(drawerDirty){
  while(drawerItems.firstChild)drawerItems.removeChild(drawerItems.firstChild);
  var source=categories.getElementsByTagName('button');
  for(var j=0;j<source.length;j++){(function(original){
   var copy=document.createElement('button');copy.type='button';copy.textContent=original.textContent;copy.className=original.className;
   copy.onclick=function(){closeDrawer();original.click();};drawerItems.appendChild(copy);
  })(source[j]);}
  drawerDirty=false;
 }
 drawer.style.display='block';var b=drawerItems.getElementsByTagName('button');if(b.length)b[0].focus();
}
drawerClose.onclick=closeDrawer;openBtn.onclick=openDrawer;
prev.onclick=function(){categories.scrollLeft=Math.max(0,categories.scrollLeft-520);};
next.onclick=function(){categories.scrollLeft+=520;};
back.onclick=function(){var b=categories.getElementsByTagName('button');if(b.length)b[0].click();};
function sync(mode,selected,items){
 currentMode=mode;active=String(selected||'all');
 browser.className=active==='all'?'tv-catalog-all':'tv-catalog-filtered';
 var modeLabel=mode==='live'?'Canlı TV':mode==='movie'?'Filmler':'Diziler';
 var chosen='Tümü';var source=categories.getElementsByTagName('button');var selectedName='';for(var ci=0;ci<items.length;ci++)if(String(items[ci].category_id)===active)selectedName=String(items[ci].category_name||'');
 for(var i=0;i<source.length;i++){var b=source[i];b.className=String(i===0&&active==='all'||i>0&&selectedName&&b.textContent===selectedName?'active':'');if(b.className==='active'){chosen=b.textContent;}}
 current.textContent=active==='all'?modeLabel+'  ›  Tümü':modeLabel+'  ›  '+chosen;
 back.style.display=active==='all'?'none':'inline-block';
 categories.style.display=active==='all'?'block':'none';
 prev.style.display=next.style.display=active==='all'?'inline-block':'none';
 openBtn.textContent=active==='all'?'▦  Tüm Kategoriler':'▦  Kategori Değiştir';
 drawerTitle.textContent=modeLabel+' Kategorileri';
 drawerDirty=true;
 if(active==='all')categories.scrollLeft=0;
}
function beforePlay(){
 if((' '+document.body.className+' ').indexOf(' tv-fullscreen ')<0){
  playingFocus=seriesPoster&&seriesPoster.offsetWidth&&seriesPoster.offsetHeight?seriesPoster:document.activeElement;
  var cards=document.getElementById('iptv-channels');playingScroll=cards?cards.scrollTop:0;
 }
 var cls=' '+document.body.className+' ';
 if(cls.indexOf(' tv-fullscreen ')<0)document.body.className+=' tv-fullscreen';
 closeDrawer();
}
function exitPlayer(){
 if(window.XIPTVEpisodeNext&&window.XIPTVEpisodeNext.cancel)window.XIPTVEpisodeNext.cancel();
 var v=document.getElementById('video');
 try{v.pause();v.removeAttribute('src');v.load();}catch(e){}
 document.body.className=(' '+document.body.className+' ').replace(/ tv-fullscreen /g,' ').replace(/^\s+|\s+$/g,'');
 var episodes=document.getElementById('tv-next-episode');if(episodes)episodes.style.display='none';
 var ch=document.getElementById('tv-channel-panel');if(ch)ch.style.display='none';
 if(window.XIPTVPlayerUI&&window.XIPTVPlayerUI.closeMenu)window.XIPTVPlayerUI.closeMenu();
 var cards=document.getElementById('iptv-channels');
 if(cards)cards.scrollTop=playingScroll;
 if(playingFocus&&playingFocus.offsetWidth&&playingFocus.offsetHeight)playingFocus.focus();
 else if(cards){var b=cards.getElementsByTagName('button');if(b.length)b[0].focus();}
}
document.addEventListener('keydown',function(e){
 var k=e.keyCode||e.which;if(k!==461&&k!==27)return;
 if(drawer.style.display==='block'){closeDrawer();if(e.preventDefault)e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();return;}
 if((' '+document.body.className+' ').indexOf(' tv-fullscreen ')>=0)return;
 if(active!=='all'&&browser.style.display!=='none'){back.click();if(e.preventDefault)e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();}
},true);
window.XIPTVCatalogLayout={sync:sync,beforePlay:beforePlay,exitPlayer:exitPlayer,closeDrawer:closeDrawer,rememberSeriesPoster:function(){seriesPoster=document.activeElement;},clearSeriesPoster:function(){seriesPoster=null;}};
})();
