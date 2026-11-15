/* XIPTV Play webOS 2 — four static themes, ES5 and no network dependencies. */
(function(){
 var PREFIX='xiptv_webos2_theme_v1_';
 var CLASS_PREFIX='xiptv-theme-',currentProfile='default',currentChild=false;
 var themes={classic:true,cinema:true,kids:true,lite:true};
 var selector=document.getElementById('tv-theme-select');
 var details=document.getElementById('tv-theme-description');
 var names={classic:'Klasik: mevcut arayüz; 6 büyük dikey poster.',cinema:'Sinema OLED: siyah/altın tonlar, geniş film afişleri.',kids:'Çocuk Dünyası: büyük, renkli seçim alanları.',lite:'Hızlı ve Sade: büyük yazılar, liste biçiminde kartlar; animasyon yok.'};
 function storageKey(){return PREFIX+currentProfile;}
 function saved(){
  try{var result=localStorage.getItem(storageKey());if(themes[result])return result;}catch(e){}
  return currentChild?'kids':'classic';
 }
 function rootClass(theme){
  var root=document.documentElement,parts=String(root.className||'').split(/\s+/),out=[];
  for(var i=0;i<parts.length;i++)if(parts[i]&&parts[i].indexOf(CLASS_PREFIX)!==0)out.push(parts[i]);
  out.push(CLASS_PREFIX+theme);root.className=out.join(' ');
 }
 function apply(theme,persist){
  if(!themes[theme])theme='classic';
  if(persist){try{localStorage.setItem(storageKey(),theme);}catch(e){}}
  rootClass(theme);
  if(selector)selector.value=theme;
  if(details)details.textContent=names[theme];
  return theme;
 }
 function applyProfile(id,child){
  currentProfile=String(id||'default');currentChild=!!child;
  return apply(saved(),false);
 }
 if(selector)selector.onchange=function(){apply(this.value,true);};
 window.XIPTVTheme={applyProfile:applyProfile,select:function(t){return apply(t,true);},current:function(){return saved();}};
 // The profile module is loaded before the theme module. Restore its persisted choice here.
 var activeId='default',child=false;
 try{
  activeId=localStorage.getItem('xiptv_webos2_active_profile_v1')||'default';
  var profiles=JSON.parse(localStorage.getItem('xiptv_webos2_profiles_v1')||'[]');
  for(var i=0;i<profiles.length;i++)if(String(profiles[i].id)===activeId){child=!!profiles[i].child;break;}
 }catch(e){}
 applyProfile(activeId,child);
})();