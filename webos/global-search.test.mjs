import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

function setup(){
 function el(tag='div'){
  return {tagName:tag.toUpperCase(),style:{display:'none'},children:[],value:'',checked:false,className:'',textContent:'',
   appendChild(child){this.children.push(child);child.parentNode=this;return child;},
   removeChild(child){this.children.splice(this.children.indexOf(child),1);},
   get firstChild(){return this.children[0]||null;},
   getElementsByTagName(tag){return this.children.flatMap(c=>[...(c.tagName===tag.toUpperCase()?[c]:[]),...c.getElementsByTagName(tag)]);},
   getAttribute(name){return this[name];},focus(){},blur(){this.blurred=true;},click(){this.onclick?.();}};
 }
 const ids={};for(const id of ['tv-global-search','tv-global-search-input','tv-global-search-results','tv-global-search-count','tv-global-scopes','tv-global-search-close','tv-nav-search','tv-search','tv-search-scope','tv-hide-adult','tv-tr-only','tv-filter-year-min','tv-filter-genre','tv-filter-min-rating','tv-home-live','tv-home-films','tv-home-series','tv-tab-live','tv-tab-movie','tv-tab-series'])ids[id]=el();
 for(const scope of ['all','live','movie','series']){const b=el('button');b['data-scope']=scope;ids['tv-global-scopes'].appendChild(b);}
 const selected=[],tabs=[],opened=[];let allowed=true,keyboardClosed=0;
 for(const [kind,id] of [['live','tv-home-live'],['movie','tv-home-films'],['series','tv-home-series']])ids[id].onclick=()=>{selected.push(kind);ids['tv-search'].value='';ids['tv-search-scope'].value='all';};
 for(const kind of ['live','movie','series'])ids['tv-tab-'+kind].onclick=()=>tabs.push(kind);
 const series={name:'Gigantosaurus (2019)',series_id:123};
 const film={name:'Gigantosaurus movie',stream_id:456};
 const live={name:'Gigantosaurus TV',stream_id:789};
 const window={XIPTVGlobalCatalog:{seriesList:[series],vodStreams:[film],liveStreams:[live]},
  XIPTVTV:{canShowItem:()=>allowed,openItem:(kind,item)=>opened.push({kind,item})},
  XIPTVKeyboard:{isOpen:()=>true,close:()=>keyboardClosed++}};
 const document={body:el(),getElementById:id=>ids[id],createElement:el,addEventListener(){}};
 vm.runInNewContext(fs.readFileSync('webos/tv-global-search.js','utf8'),{window,document,setTimeout:()=>1,clearTimeout(){}});
 ids['tv-global-search-input'].value='giganto';window.XIPTVGlobalSearch.open();
 function find(cls,text){return ids['tv-global-search-results'].getElementsByTagName('button').find(b=>b.className===cls&&(!text||b.textContent===text));}
 return {ids,window,series,film,live,selected,tabs,opened,find,deny(){allowed=false;},keyboardClosed:()=>keyboardClosed};
}
test('Selected series opens exact ID and episodes, rather than refiltering by title',()=>{
 const s=setup();s.ids['tv-filter-year-min'].value='2025';s.ids['tv-filter-genre'].value='Drama';s.ids['tv-filter-min-rating'].value='9';
 s.find('tv-global-result',s.series.name).click();
 assert.equal(s.opened.length,1);assert.equal(s.opened[0].kind,'series');assert.equal(s.opened[0].item,s.series);
 assert.deepEqual(s.selected,['series']);assert.deepEqual(s.tabs,[]);
 assert.equal(s.ids['tv-search'].value,'');assert.equal(s.ids['tv-global-search'].style.display,'none');
 for(const id of ['tv-filter-year-min','tv-filter-genre','tv-filter-min-rating'])assert.equal(s.ids[id].value,'');
 assert.equal(s.keyboardClosed(),1);assert.equal(s.ids['tv-global-search-input'].blurred,true);
});
test('Movie and live results forward their original stream IDs',()=>{
 for(const [kind,field] of [['movie','film'],['live','live']]){
  const s=setup();s.find('tv-global-result',s[field].name).click();
  assert.equal(s.opened[0].kind,kind);assert.equal(s.opened[0].item,s[field]);
 }
});
test('Show all filters the selected catalogue without starting playback',()=>{
 const s=setup();s.find('tv-global-all').click();
 assert.deepEqual(s.selected,['live']);assert.deepEqual(s.tabs,['live']);assert.equal(s.opened.length,0);
 assert.equal(s.ids['tv-search'].value,'giganto');assert.equal(s.ids['tv-search-scope'].value,'name');
 assert.equal(s.window.XIPTVGlobalSearch.normal('ÇIĞ ŞÖÜ'),'cig sou');
});
test('Changing profile permissions before click cannot open a denied result',()=>{
 const s=setup();const result=s.find('tv-global-result',s.series.name);s.deny();result.click();
 assert.equal(s.opened.length,0);assert.equal(s.selected.length,0);
});
