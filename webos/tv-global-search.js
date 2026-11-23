/* Universal search across the already loaded Xtream catalog. ES5 / webOS 2. */
(function(){
var overlay=document.getElementById('tv-global-search'),input=document.getElementById('tv-global-search-input'),results=document.getElementById('tv-global-search-results'),scope='all',timer=null;
/* Move outside the legacy panel: the panel is hidden on the Home screen. */
document.body.appendChild(overlay);
var groups=[{id:'live',label:'Canlı TV',field:'liveStreams'},{id:'movie',label:'Filmler',field:'vodStreams'},{id:'series',label:'Diziler',field:'seriesList'}];
function normal(s){return String(s||'').toLocaleLowerCase?String(s||'').toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s').replace(/ö/g,'o').replace(/ç/g,'c'):String(s||'').toLowerCase();}
function clear(el){while(el.firstChild)el.removeChild(el.firstChild);}
function node(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function open(){overlay.style.display='block';document.getElementById('tv-nav-search').className='selected';render();input.focus();}
function close(){clearTimeout(timer);if(input.blur)input.blur();overlay.style.display='none';if(window.XIPTVKeyboard&&window.XIPTVKeyboard.isOpen())window.XIPTVKeyboard.close();}
function openSection(kind){
 // A global search must not inherit hidden year/genre/rating constraints.
 var ids=['tv-filter-year-min','tv-filter-genre','tv-filter-min-rating'];
 for(var i=0;i<ids.length;i++){var field=document.getElementById(ids[i]);if(field)field.value='';}
 document.getElementById(kind==='live'?'tv-home-live':kind==='movie'?'tv-home-films':'tv-home-series').click();
}
function showCategory(kind,term){
 close();openSection(kind);
 document.getElementById('tv-search').value=term;
 document.getElementById('tv-search-scope').value='name';
 document.getElementById('tv-tab-'+kind).click();
}
function openResult(kind,item){
 // Use the exact catalogue object/ID. Searching again by title can lose
 // the selected entry to category/language filters or ambiguous names.
 if(!canShow(kind,item)){render();return;}
 if(!window.XIPTVTV||typeof window.XIPTVTV.openItem!=='function')return;
 close();openSection(kind);
 window.XIPTVTV.resumeSeriesFromHome=false;
 window.XIPTVTV.openItem(kind,item);
}
function canShow(kind,item){if(window.XIPTVTV&&window.XIPTVTV.canShowItem&&!window.XIPTVTV.canShowItem(kind,item))return false;var adult=document.getElementById('tv-hide-adult'),tr=document.getElementById('tv-tr-only');var title=String(item.name||item.title||'');if(window.XIPTVAdultFilter&&window.XIPTVAdultFilter.hidden(kind,item))return false;if(tr&&tr.checked&&/\b(EN|US|UK)\b/i.test(title))return false;return true;}
function render(){
 clear(results);var catalog=window.XIPTVGlobalCatalog,term=input.value.replace(/^\s+|\s+$/g,'');
 if(!catalog){results.appendChild(node('p','tv-global-hint','Katalog yükleniyor. Önce IPTV hesabına bağlanın.'));return;}
 if(!term){results.appendChild(node('p','tv-global-hint','Canlı TV, filmler ve diziler arasında aramak için bir ad yazın.'));return;}
 var needle=normal(term),count=0;
 for(var g=0;g<groups.length;g++){var group=groups[g];if(scope!=='all'&&scope!==group.id)continue;var list=catalog[group.field]||[],hits=[],total=0;for(var i=0;i<list.length;i++){var item=list[i];if(!item||!canShow(group.id,item))continue;var name=String(item.name||item.title||'');if(normal(name).indexOf(needle)===-1)continue;total++;if(hits.length<8)hits.push(item);}
 count+=total;var section=node('section','tv-global-group'),heading=node('div','tv-global-group-heading'),title=node('strong','',group.label+' ('+total+')'),all=node('button','tv-global-all','Tümünü Gör');(function(kind){all.onclick=function(){showCategory(kind,term);};})(group.id);heading.appendChild(title);heading.appendChild(all);section.appendChild(heading);
 if(!hits.length)section.appendChild(node('p','tv-global-empty','Bu kategoride sonuç bulunamadı.'));
 for(var j=0;j<hits.length;j++){(function(kind,item){var b=node('button','tv-global-result',String(item.name||item.title||'İsimsiz içerik'));b.onclick=function(){openResult(kind,item);};section.appendChild(b);})(group.id,hits[j]);}
 results.appendChild(section);}
 document.getElementById('tv-global-search-count').textContent=count+' sonuç';
}
function changeScope(next){scope=next;var chips=document.getElementById('tv-global-scopes').getElementsByTagName('button');for(var i=0;i<chips.length;i++)chips[i].className=chips[i].getAttribute('data-scope')===next?'selected':'';render();}
var chips=document.getElementById('tv-global-scopes').getElementsByTagName('button');for(var c=0;c<chips.length;c++){(function(b){b.onclick=function(){changeScope(b.getAttribute('data-scope'));};})(chips[c]);}
document.getElementById('tv-nav-search').onclick=open;
document.getElementById('tv-global-search-close').onclick=close;
input.oninput=function(){clearTimeout(timer);timer=setTimeout(render,180);};
input.onkeyup=function(){clearTimeout(timer);timer=setTimeout(render,180);};
document.addEventListener('keydown',function(e){if(overlay.style.display!=='block'||window.XIPTVKeyboard&&window.XIPTVKeyboard.isOpen())return;var k=e.keyCode||e.which;if(k===461||k===27){close();if(e.preventDefault)e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();}},true);
window.XIPTVGlobalSearch={open:open,close:close,render:render,normal:normal};
})();
