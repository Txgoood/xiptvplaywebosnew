/* LG webOS 2 / ES5: interpret credentials embedded in IPTV playlist URLs. */
(function(root){
  function decode(value){try{return decodeURIComponent(String(value||'').replace(/\+/g,' '));}catch(e){return String(value||'');}}
  function params(query){var out={},parts=String(query||'').split('&'),i,p,at,key;
    for(i=0;i<parts.length;i++){p=parts[i];at=p.indexOf('=');key=decode(at<0?p:p.slice(0,at)).toLowerCase();if(key)out[key]=decode(at<0?'':p.slice(at+1));}return out;
  }
  function parse(raw,user,pass){
    var value=String(raw||'').replace(/^\s+|\s+$/g,''),username=String(user||'').replace(/^\s+|\s+$/g,''),password=String(pass||''),p,base,pathname,query,credentials=false;
    if(!value)return {error:'Sunucu veya playlist adresini yazın.'};
    if(!/^https?:\/\//i.test(value))value='http://'+value;
    p=/^(https?:\/\/[^\/?#]+)(\/[^?#]*)?(?:\?([^#]*))?/i.exec(value);
    if(!p)return {error:'Geçerli bir http:// veya https:// adresi girin.'};
    base=p[1];pathname=(p[2]||'/').replace(/\/+$/,'');query=params(p[3]||'');
    if(query.username&&query.password){username=query.username;password=query.password;credentials=true;}
    if(!credentials){
      var pathParts=pathname.split('/'),liveIndex=-1;
      for(var i=0;i<pathParts.length;i++)if(/^(live|movie|series)$/.test(pathParts[i].toLowerCase())){liveIndex=i;break;}
      if(liveIndex>=0&&pathParts.length>liveIndex+2){username=decode(pathParts[liveIndex+1]);password=decode(pathParts[liveIndex+2]);credentials=true;pathname=pathParts.slice(0,liveIndex).join('/');}
    }
    var file=/\.(m3u8?|txt|xml|json)$/i.test(pathname),endpoint=/(?:^|\/)(get\.php|player_api\.php|panel_api\.php|xmltv\.php|portal\.php)$/i.test(pathname);
    if(file&&!credentials)return {error:'Bu adres bağımsız bir M3U dosyası. Mevcut katalog sistemi Xtream API gerektiriyor; M3U dosyası için ayrı katalog desteği gerekli.'};
    if(!username||!password)return {error:'Bu adreste kullanıcı adı ve şifre bulunamadı. Xtream giriş bilgilerini ayrı alanlara yazın.'};
    var server=base;
    if(endpoint)server+=pathname.slice(0,pathname.lastIndexOf('/'));
    else if(!file&&pathname&&pathname!=='/')server+=pathname;
    return {server:server.replace(/\/+$/,''),username:username,password:password,kind:credentials?'url':'fields'};
  }
  root.XIPTVPlaylistInput={parse:parse};
})(typeof window!=='undefined'?window:this);
