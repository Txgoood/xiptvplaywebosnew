import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

function grid(columns,count,{previous=false,next=false}={}){
 const window={};vm.runInNewContext(fs.readFileSync('webos/tv-catalog-navigation.js','utf8'),{window});
 const root={children:[],scrollTop:0,getBoundingClientRect:()=>({top:100,bottom:600})};
 let active=null;const cards=[];
 function add(name,x,y,width,height){
  const parent={className:name,contains:b=>parent.buttons.indexOf(b)>=0,getElementsByTagName:()=>parent.buttons};
  const button={parentNode:parent,offsetWidth:width,offsetHeight:height,
   getBoundingClientRect:()=>({left:x,top:y-root.scrollTop,width,height,bottom:y-root.scrollTop+height}),
   focus:()=>{active=button;}};
  parent.buttons=[button];root.children.push(parent);return button;
 }
 if(previous)add('tv-page-bar',0,100,180,42);
 const top=previous?160:100;
 for(let i=0;i<count;i++)cards.push(add('tv-item-wrap',(i%columns)*110,top+Math.floor(i/columns)*210,100,200));
 if(next)add('tv-page-bar',0,top+Math.ceil(count/columns)*210,180,42);
 return {root,cards,nav:window.XIPTVCatalogNavigation,getActive:()=>active};
}
for(const columns of [4,6])test('Directional rows and columns at '+columns+' columns',()=>{
 const {root,cards,nav}=grid(columns,columns*2+2);
 assert.equal(nav.target(root,cards[0],39),cards[1]);
 assert.equal(nav.target(root,cards[1],37),cards[0]);
 assert.equal(nav.target(root,cards[1],40),cards[columns+1]);
 assert.equal(nav.target(root,cards[columns+1],38),cards[1]);
 assert.equal(nav.target(root,cards[columns*2-1],40),cards[columns*2+1], 'partial last row chooses nearest column');
 assert.equal(nav.target(root,cards[0],37),null,'left edge must not wrap');
 assert.equal(nav.target(root,cards[columns-1],39),null,'right edge must not wrap to another row');
 assert.equal(nav.target(root,cards[1],38),null,'top row returns to navigation');
});
test('Pagination rows are reachable without taking a poster cell',()=>{
 const {root,cards,nav}=grid(6,8,{previous:true,next:true});
 assert.equal(nav.first(root),cards[0]);
 assert.equal(nav.target(root,cards[0],38),root.children[0].buttons[0]);
 assert.equal(nav.target(root,cards[7],40),root.children[root.children.length-1].buttons[0]);
});
test('Badges are skipped; focus scrolls selected poster into view',()=>{
 const {root,cards,nav,getActive}=grid(6,24);
 const badge={};cards[0].parentNode.buttons.push(badge);
 assert.equal(nav.target(root,badge,39),cards[1]);
 nav.focus(root,cards[18]);assert.equal(getActive(),cards[18]);
 assert(root.scrollTop>0);
 const visible=cards[18].getBoundingClientRect();assert(visible.bottom<=594);
 nav.focus(root,cards[0]);assert.equal(root.scrollTop,0);
});

test('Repeated directional moves reuse measurements until catalogue invalidates',()=>{
 const {root,cards,nav}=grid(6,24);
 let reads=0;
 for(const button of cards){
  const original=button.getBoundingClientRect;
  button.getBoundingClientRect=()=>{reads++;return original();};
 }
 assert.equal(nav.target(root,cards[0],39),cards[1]);
 const initial=reads;
 assert.equal(initial,24);
 assert.equal(nav.target(root,cards[1],40),cards[7]);
 assert.equal(reads,initial,'no repeated layout measurements on remote key presses');
 nav.invalidate(root);
 assert.equal(nav.target(root,cards[1],40),cards[7]);
 assert.equal(reads,initial+24,'a new page refreshes geometry');
});
test('Scrolling keeps cached relative positions and restores focus',()=>{
 const {root,cards,nav}=grid(6,24);
 nav.focus(root,cards[18]);
 assert.equal(nav.target(root,cards[18],38),cards[12]);
 assert.equal(nav.target(root,cards[12],40),cards[18]);
});
