/* XIPTV Play webOS 2 - Turkish Q TV keyboard, ES5 only. */
(function(){
var box=document.getElementById('iptv-keyboard'),keys=document.getElementById('iptv-keys'),display=document.getElementById('iptv-keyboard-title'),target=null,upper=false,row=0,col=0,rows=[],lastFocus=null;
/* Keyboard must work when the main catalog panel is hidden. */
document.body.appendChild(box);
var names=['iptv-server','iptv-user','iptv-pass','tv-search','tv-global-search-input','tv-profile-name','tv-profile-pin'];
var letters=[['q','w','e','r','t','y','u','ı','o','p','ğ','ü'],['a','s','d','f','g','h','j','k','l','ş','i'],['SHIFT','z','x','c','v','b','n','m','ö','ç','BACK']];
var functionsRow=['123','ABC','BOŞLUK','SİL','TEMİZLE','←','→','.','@','.com','ARA','KAPAT'];
var numberRow=[['1','2','3','4','5','6','7','8','9','0'],['-','_','/',':','!','?','&','+','=','.'],['http://','https://','www.',':8080','.net','.xyz','@','BACK']];
var numberMode=false;
function visible(){return box.style.display==='block';}
function label(){if(!target)return;var n=target.id==='iptv-server'?'Sunucu':target.id==='iptv-user'?'Kullanıcı':target.id==='iptv-pass'?'Şifre':target.id==='tv-profile-name'?'Profil adı':target.id==='tv-profile-pin'?'PIN':'Tüm içeriklerde ara';display.textContent=n+'  ·  '+(target.type==='password'?new Array(target.value.length+1).join('●'):target.value||'Yazmaya başlayın');}
function close(){box.style.display='none';if(lastFocus&&lastFocus.focus)lastFocus.focus();}
function emit(){try{var ev=document.createEvent('Event');ev.initEvent('input',true,true);target.dispatchEvent(ev);}catch(e){}if(typeof target.onkeyup==='function')target.onkeyup();label();}
function apply(value){
 if(value==='KAPAT'||value==='ARA'){close();if(value==='ARA'&&window.XIPTVGlobalSearch&&target.id==='tv-global-search-input')window.XIPTVGlobalSearch.render();return;}
 if(value==='SHIFT'||value==='ABC'){upper=!upper;paint();return;}
 if(value==='123'){numberMode=!numberMode;paint();return;}
 if(value==='SİL'||value==='BACK'){target.value=target.value.slice(0,-1);emit();return;}
 if(value==='TEMİZLE'){target.value='';emit();return;}
 if(value==='←'||value==='→'){var at=typeof target.selectionStart==='number'?target.selectionStart:target.value.length;var to=Math.max(0,Math.min(target.value.length,at+(value==='←'?-1:1)));try{target.setSelectionRange(to,to);}catch(e){}label();return;}
 var v=value==='BOŞLUK'?' ':value;if(upper&&v.length===1)v=v.toUpperCase();
 var start=typeof target.selectionStart==='number'?target.selectionStart:target.value.length,end=typeof target.selectionEnd==='number'?target.selectionEnd:start;
 target.value=target.value.slice(0,start)+v+target.value.slice(end);try{target.setSelectionRange(start+v.length,start+v.length);}catch(e){}emit();
}
function focusKey(r,c){if(!rows.length)return;row=Math.max(0,Math.min(rows.length-1,r));col=Math.max(0,Math.min(rows[row].length-1,c));for(var i=0;i<rows.length;i++)for(var j=0;j<rows[i].length;j++)rows[i][j].className=rows[i][j].className.replace(/\s*active/g,'');var b=rows[row][col];b.className+=' active';b.focus();}
function paint(){
 keys.innerHTML='';rows=[];var grid=numberMode?numberRow:letters;grid=grid.concat([functionsRow]);
 for(var r=0;r<grid.length;r++){var line=document.createElement('div');line.className='iptv-key-row count-'+grid[r].length;keys.appendChild(line);var buttons=[];for(var c=0;c<grid[r].length;c++){(function(value){var b=document.createElement('button');b.type='button';b.textContent=value==='SHIFT'?'⇧':value==='BACK'?'⌫':value;b.className='iptv-key'+(value==='BOŞLUK'?' wide':'')+(value==='ARA'?' primary':'')+(value==='KAPAT'?' secondary':'');b.onclick=function(){apply(value);};line.appendChild(b);buttons.push(b);})(grid[r][c]);}rows.push(buttons);}
 focusKey(row,col);label();
}
function open(id){var t=document.getElementById(id);if(!t)return;lastFocus=document.activeElement;target=t;row=0;col=0;numberMode=false;box.style.display='block';paint();}
document.getElementById('iptv-keyboard-close').onclick=close;
for(var i=0;i<names.length;i++){(function(id){var el=document.getElementById(id);if(!el)return;var trigger=document.getElementById(id+'-keyboard');if(trigger)trigger.onclick=function(){open(id);};el.addEventListener('click',function(){open(id);},false);})(names[i]);}
document.addEventListener('keydown',function(e){if(!visible())return;var k=e.keyCode||e.which;if(k===37)focusKey(row,col-1);else if(k===39)focusKey(row,col+1);else if(k===38)focusKey(row-1,col);else if(k===40)focusKey(row+1,col);else if(k===13){rows[row][col].click();}else if(k===461||k===27)close();else return;if(e.preventDefault)e.preventDefault();if(e.stopImmediatePropagation)e.stopImmediatePropagation();},true);
window.XIPTVKeyboard={open:open,close:close,isOpen:visible};
})();
