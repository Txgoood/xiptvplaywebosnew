/* XIPTV Play webOS 2 profile selection: ES5, local-only, separate media preferences. */
(function(){
var KEY='xiptv_webos2_profiles_v1',ACTIVE='xiptv_webos2_active_profile_v1';
var panel=document.getElementById('tv-profile-panel'),items=document.getElementById('tv-profile-items'),nameInput=document.getElementById('tv-profile-name'),pinInput=document.getElementById('tv-profile-pin');
function read(){try{var data=JSON.parse(localStorage.getItem(KEY)||'null');if(data&&data.length)return data;}catch(e){}return [{id:'default',name:'Ana Profil',pin:'',child:false}];}
function write(data){try{localStorage.setItem(KEY,JSON.stringify(data));}catch(e){}}
function activeId(){try{return localStorage.getItem(ACTIVE)||'default';}catch(e){return 'default';}}
function select(p){
 var entered=pinInput.value||'';
 if(p.pin && entered!==p.pin){document.getElementById('tv-profile-message').textContent='PIN hatalı';return;}
 try{localStorage.setItem(ACTIVE,p.id);}catch(e){}
 panel.style.display='none';pinInput.value='';
 document.getElementById('tv-profile-switch').textContent='Profil: '+p.name;
 if(window.XIPTVTV&&window.XIPTVTV.setProfile)window.XIPTVTV.setProfile(p.id,p.child);
}
function render(){
 while(items.firstChild)items.removeChild(items.firstChild);
 var data=read();for(var i=0;i<data.length;i++){(function(p){
 var b=document.createElement('button');b.type='button';b.textContent=p.name+(p.child?' · Çocuk':'')+(p.pin?' · PIN':'');
 b.onclick=function(){select(p);};items.appendChild(b);
 })(data[i]);}
}
document.getElementById('tv-profile-switch').onclick=function(){render();panel.style.display='block';};
document.getElementById('tv-profile-close').onclick=function(){panel.style.display='none';};
document.getElementById('tv-profile-add').onclick=function(){
 var name=(nameInput.value||'').replace(/^\s+|\s+$/g,'');if(!name)return;
 var data=read();if(data.length>=8){document.getElementById('tv-profile-message').textContent='En fazla 8 profil';return;}
 var child=document.getElementById('tv-profile-child').checked;
 var pin=pinInput.value||'';
 if(pin&&!/^\d{4}$/.test(pin)){document.getElementById('tv-profile-message').textContent='PIN 4 rakam olmalı';return;}
 var profile={id:'tv'+Date.now(),name:name.slice(0,30),pin:pin,child:child};
 data.push(profile);write(data);nameInput.value='';pinInput.value='';render();
 document.getElementById('tv-profile-message').textContent='Profil eklendi';
};
var profiles=read(),active=activeId(),found=profiles[0];for(var n=0;n<profiles.length;n++)if(profiles[n].id===active)found=profiles[n];
document.getElementById('tv-profile-switch').textContent='Profil: '+found.name;
if(window.XIPTVTV&&window.XIPTVTV.setProfile)window.XIPTVTV.setProfile(found.id,found.child);
})();
