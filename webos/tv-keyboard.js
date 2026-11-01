/* webOS 2 / Magic Remote: large ES5 keyboard with shortcuts and case toggle. */
(function(){
var box=document.getElementById('iptv-keyboard'),keys=document.getElementById('iptv-keys'),display=document.getElementById('iptv-keyboard-title');
var target=null,upper=false,selection=0,buttons=[],cols=10;
var names=['iptv-server','iptv-user','iptv-pass','tv-search','tv-profile-name','tv-profile-pin'];
var lines=['1234567890','qwertyuiop','asdfghjkl','zxcvbnm'];
var extra=['http://','https://','www.','.com','.net','.xyz',':8080','.',':','/','-','_','@','!','?','&','=','%','+','BOŞLUK','SİL','TÜMÜNÜ SİL','ABC ⇄ abc','SONRAKİ ALAN','TAMAM'];
document.getElementById('iptv-keyboard-close').onclick=function(){box.style.display='none';};
function visible(){return box.style.display!=='none';}
function title(){
 var name=target.id==='iptv-server'?'Sunucu':target.id==='iptv-user'?'Kullanıcı':target.id==='iptv-pass'?'Şifre':target.id==='tv-search'?'Arama':target.id==='tv-profile-name'?'Profil Adı':'PIN';
 var value=target.type==='password'?new Array(target.value.length+1).join('●'):target.value;
 display.textContent=name+' | '+(upper?'BÜYÜK HARF':'küçük harf')+' | '+value;
}
function focusAt(n){
 if(!buttons.length)return;
 selection=(n+buttons.length)%buttons.length;
 for(var i=0;i<buttons.length;i++)buttons[i].className=i===selection?'active':'';
 buttons[selection].focus();
 buttons[selection].scrollIntoView(false);
}
function append(label,value){
 var b=document.createElement('button');b.type='button';
 b.textContent=label;b.style.cssText='min-width:67px;margin:4px;padding:10px;font-size:20px';
 b.onclick=function(){press(value);};keys.appendChild(b);buttons.push(b);
}
function paint(keep){
 while(keys.firstChild)keys.removeChild(keys.firstChild);
 buttons=[];
 for(var i=0;i<lines.length;i++)for(var j=0;j<lines[i].length;j++){
   var c=lines[i].charAt(j);
   append(upper?c.toUpperCase():c,c);
 }
 for(var n=0;n<extra.length;n++)append(extra[n],extra[n]);
 focusAt(keep?selection:0);title();
}
function notify(){try{var e=document.createEvent('Event');e.initEvent('input',true,true);target.dispatchEvent(e);if(target.onkeyup)target.onkeyup();}catch(x){if(target.onkeyup)target.onkeyup();}}
function write(v){target.value+=v;notify();title();}
function press(v){
 if(!target)return;
 if(v==='TAMAM'){box.style.display='none';target.focus();return;}
 if(v==='ABC ⇄ abc'){upper=!upper;paint(true);return;}
 if(v==='SONRAKİ ALAN'){
   var n=names.indexOf(target.id);open(names[(n+1)%names.length]);return;
 }
 if(v==='SİL'){target.value=target.value.slice(0,-1);notify();}
 else if(v==='TÜMÜNÜ SİL'){target.value='';notify();}
 else write(v==='BOŞLUK'?' ':v.length===1&&upper?v.toUpperCase():v);
 title();
 focusAt(selection);
}
function open(id){
 target=document.getElementById(id);if(!target)return;
 box.style.display='block';selection=0;paint(false);
}
for(var i=0;i<names.length;i++){
 (function(id){var el=document.getElementById(id);if(!el)return;
 var trigger=document.getElementById(id+'-keyboard');if(trigger)trigger.onclick=function(){open(id);};
 el.addEventListener('click',function(){open(id);},false);
 })(names[i]);
}
document.addEventListener('keydown',function(e){
 if(!visible())return;
 var k=e.keyCode||e.which;
 if(k===37||k===38||k===39||k===40){
   focusAt(selection+(k===37?-1:k===39?1:k===38?-cols:cols));
 }else if(k===13){buttons[selection].click();}
 else if(k===461||k===27){box.style.display='none';}
 else{return;}
 if(e.preventDefault)e.preventDefault();
 if(e.stopImmediatePropagation)e.stopImmediatePropagation();
},true);
})();
