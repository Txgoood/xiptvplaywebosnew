import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./tv-features.js',import.meta.url),'utf8');
const isolated=source.split('/* XIPTV TV companion controls')[0];
function makeFilter(enabled=true,child=false){
 const document={getElementById:()=>({checked:enabled})};
 const window={XIPTVTV:{isChildProfile:()=>child},XIPTVGlobalCatalog:{
  liveCategories:[{category_id:'1',category_name:'TR | Belgesel'},{category_id:'2',category_name:'TR | Yetişkin'}],
  vodCategories:[{category_id:'5',category_name:'Filmler'},{category_id:'6',category_name:'Erotik Filmler'}],
  seriesCategories:[{category_id:'8',category_name:'Diziler'},{category_id:'9',category_name:'Adult Series'}]}};
 vm.runInNewContext(isolated,{window,document});
 return window.XIPTVAdultFilter;
}
test('all modes: category checks include markers anywhere in a name',()=>{
 const f=makeFilter();
 assert.equal(f.hidden('live',{name:'Gece TV',category_id:'2'}),true);
 assert.equal(f.hidden('movie',{name:'Film',category_id:'6'}),true);
 assert.equal(f.hidden('series',{name:'Dizi',category_id:'9'}),true);
 assert.equal(f.hidden('live',{name:'TRT Çocuk',category_id:'1'}),false);
});
test('titles and genres filtered, safe names remain visible',()=>{
 const f=makeFilter();
 assert.equal(f.hidden('live',{name:'TR 18+ Kanal',category_id:'1'}),true);
 assert.equal(f.hidden('movie',{name:'Erotik Film',category_id:'5'}),true);
 assert.equal(f.hidden('movie',{name:'Aşk',genre:'Erotica',category_id:'5'}),true);
 assert.equal(f.hidden('movie',{name:'Adulting',category_id:'5'}),false);
 assert.equal(f.hidden('movie',{name:'Honey (2026)',category_id:'5'}),false);
});
test('setting off respects unrestricted profile but child forces hiding',()=>{
 assert.equal(makeFilter(false,false).hidden('movie',{name:'XXX Film',category_id:'5'}),false);
 assert.equal(makeFilter(false,true).hidden('movie',{name:'XXX Film',category_id:'5'}),true);
});
test('secondary category IDs are also considered',()=>{
 assert.equal(makeFilter().hidden('movie',{name:'Normal',category_id:'5',category_ids:['5','6']}),true);
});
