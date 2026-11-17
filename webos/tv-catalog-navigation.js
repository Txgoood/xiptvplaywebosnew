/* Small ES5 spatial navigator for the visible catalogue page. No timers or network. */
(function(){
 function primary(root){
  var result=[],children=root.children;
  for(var i=0;i<children.length;i++){
   var child=children[i],name=' '+child.className+' ';
   if(name.indexOf(' tv-item-wrap ')<0&&name.indexOf(' tv-page-bar ')<0)continue;
   var buttons=child.getElementsByTagName('button'),b=buttons[0];
   if(b&&!b.disabled&&b.offsetWidth>0&&b.offsetHeight>0)result.push(b);
  }
  return result;
 }
 function first(root){var all=primary(root);for(var i=0;i<all.length;i++)if((' '+all[i].parentNode.className+' ').indexOf(' tv-item-wrap ')>=0)return all[i];return all[0]||null;}
 function target(root,active,key){
  var all=primary(root),current=null;
  for(var i=0;i<all.length;i++)if(all[i]===active||all[i].parentNode.contains(active)){current=all[i];break;}
  if(!current)return first(root);
  var a=current.getBoundingClientRect(),ax=a.left+a.width/2,ay=a.top+a.height/2;
  var horizontal=key===37||key===39,best=null,score=Infinity;
  for(var j=0;j<all.length;j++){
   var candidate=all[j];if(candidate===current)continue;
   var b=candidate.getBoundingClientRect(),dx=b.left+b.width/2-ax,dy=b.top+b.height/2-ay;
   var forward=key===37?-dx:key===39?dx:key===38?-dy:dy;
   if(forward<=2)continue;
   // Left/right stay in the same row; vertical travel chooses the nearest row,
   // then the nearest column, including a partially filled last row.
   if(horizontal&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<Math.min(a.height,b.height)/2)continue;
   var rank=horizontal?forward+Math.abs(dy)*4:forward*1000+Math.abs(dx);
   if(rank<score){score=rank;best=candidate;}
  }
  return best;
 }
 function focus(root,button){
  if(!button)return;
  button.focus();
  var r=root.getBoundingClientRect(),b=button.getBoundingClientRect();
  if(b.top<r.top+6)root.scrollTop=Math.max(0,root.scrollTop+b.top-r.top-6);
  else if(b.bottom>r.bottom-6)root.scrollTop+=b.bottom-r.bottom+6;
 }
 window.XIPTVCatalogNavigation={target:target,first:first,focus:focus};
})();
