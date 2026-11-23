/* Small ES5 spatial navigator for the visible catalogue page. No timers or network. */
(function(){
 // Geometry is stable during vertical scrolling; card-to-card differences do not change.
 // Measure once per rendered page rather than 24 rectangles on every remote key press.
 var snapshots=[];
 function invalidate(root){
  for(var i=snapshots.length-1;i>=0;i--)if(!root||snapshots[i].root===root)snapshots.splice(i,1);
 }
 function snapshot(root){
  for(var i=0;i<snapshots.length;i++)if(snapshots[i].root===root)return snapshots[i];
  var buttons=primary(root),entries=[];
  for(var j=0;j<buttons.length;j++){
   var rect=buttons[j].getBoundingClientRect();
   entries.push({button:buttons[j],left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,
    width:rect.width,height:rect.height,x:rect.left+rect.width/2,y:rect.top+rect.height/2});
  }
  var value={root:root,entries:entries};
  // Never retain more than a couple of catalogue roots in old webOS memory.
  if(snapshots.length>1)snapshots.shift();
  snapshots.push(value);return value;
 }
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
 function first(root){var all=snapshot(root).entries;for(var i=0;i<all.length;i++)if((' '+all[i].button.parentNode.className+' ').indexOf(' tv-item-wrap ')>=0)return all[i].button;return all.length?all[0].button:null;}
 function target(root,active,key){
  var all=snapshot(root).entries,current=null;
  for(var i=0;i<all.length;i++)if(all[i].button===active||all[i].button.parentNode.contains(active)){current=all[i];break;}
  if(!current)return first(root);
  var a=current,ax=a.x,ay=a.y;
  var horizontal=key===37||key===39,best=null,score=Infinity;
  for(var j=0;j<all.length;j++){
   var candidate=all[j];if(candidate===current)continue;
   var b=candidate,dx=b.x-ax,dy=b.y-ay;
   var forward=key===37?-dx:key===39?dx:key===38?-dy:dy;
   if(forward<=2)continue;
   // Left/right stay in the same row; vertical travel chooses the nearest row,
   // then the nearest column, including a partially filled last row.
   if(horizontal&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<Math.min(a.height,b.height)/2)continue;
   var rank=horizontal?forward+Math.abs(dy)*4:forward*1000+Math.abs(dx);
   if(rank<score){score=rank;best=candidate;}
  }
  return best?best.button:null;
 }
 function focus(root,button){
  if(!button)return;
  button.focus();
  var r=root.getBoundingClientRect(),b=button.getBoundingClientRect();
  if(b.top<r.top+6)root.scrollTop=Math.max(0,root.scrollTop+b.top-r.top-6);
  else if(b.bottom>r.bottom-6)root.scrollTop+=b.bottom-r.bottom+6;
 }
 if(window.addEventListener)window.addEventListener('resize',function(){invalidate();},false);
 window.XIPTVCatalogNavigation={target:target,first:first,focus:focus,invalidate:invalidate};
})();
