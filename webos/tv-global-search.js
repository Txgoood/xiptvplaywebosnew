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
function close(){overlay.style.display='none';if(window.XIPTVKeyboard&&window.XIPTVKeyboard.isOpen())window.XIPTVKeyboard.close();}
function showCategory(kind,term){close();document.getElementById(kind==='live'?'tv-home-live':kind==='movie'?'tv-home-films':'tv-home-series').click();var field=document.getElementById('tv-search');field.value=term;document.getElementById('tv-tab-'+kind).click();if(typeof field.onkeyup==='function')field.onkeyup();}
function canShow(kind,item){if(window.XIPTVTV&&window.XIPTVTV.canShowItem&&!window.XIPTVTV.canShowItem(kind,item))return false;var adult=document.getElementById('tv-hide-adult'),tr=document.getElementById('tv-tr-only');var title=String(item.name||item.title||'');if(adult&&adult.checked&&/^(XXX|18\+|ADULT|🔞)/i.test(title))return false;if(tr&&tr.checked&&/\b(EN|US|UK)\b/i.test(title))return false;return true;}
function render(){
 clear(results);var catalog=window.XIPTVGlobalCatalog,term=input.value.replace(/^\s+|\s+$/g,'');
 if(!catalog){results.appendChild(node('p','tv-global-hint','Katalog yükleniyor. Önce IPTV hesabına bağlanın.'));return;}
 if(!term){results.appendChild(node('p','tv-global-hint','Canlı TV, filmler ve diziler arasında aramak için bir ad yazın.'));return;}
 var needle=normal(term),count=0;
 for(var g=0;g<groups.length;g++){var group=groups[g];if(scope!=='all'&&scope!==group.id)continue;var list=catalog[group.field]||[],hits=[],total=0;for(var i=0;i<list.length;i++){var item=list[i];if(!item||!canShow(group.id,item))continue;var name=String(item.name||item.title||'');if(normal(name).indexOf(needle)===-1)continue;total++;if(hits.length<8)hits.push(item);}
 count+=total;var section=node('section','tv-global-group'),heading=node('div','tv-global-group-heading'),title=node('strong','',group.label+' ('+total+')'),all=node('button','tv-global-all','Tümünü Gör');(function(kind){all.onclick=function(){showCategory(kind,term);};})(group.id);heading.appendChild(title);heading.appendChild(all);section.appendChild(heading);
 if(!hits.length)section.appendChild(node('p','tv-global-empty','Bu kategoride sonuç bulunamadı.'));
 for(var j=0;j<hits.length;j++){(function(kind,item){var b=node('button','tv-global-result',String(item.name||item.title||'İsimsiz içerik'));b.onclick=function(){showCategory(kind,String(item.name||item.title||''));};section.appendChild(b);})(group.id,hits[j]);}
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
window.XIPTVGlobalSearch={open:open,close:close,render:render};
})();
