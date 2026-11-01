import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const root=process.cwd(), out=path.join(root,'webos-package');
fs.rmSync(out,{recursive:true,force:true});
fs.cpSync(path.join(root,'dist'),out,{recursive:true});
const info={id:'com.xiptvplay.tv',version:'1.0.16',trustLevel:'netcast',vendorExtension:{allowCrossDomain:true},vendor:'XIPTV Play',type:'web',main:'index.html',title:'XIPTV Play',icon:'icon.png',resolution:'1920x1080'};
fs.writeFileSync(path.join(out,'appinfo.json'),JSON.stringify(info,null,2));
fs.copyFileSync(path.join(root,'webos/tv-remote.js'),path.join(out,'tv-remote.js'));
fs.copyFileSync(path.join(root,'webos/tv-iptv.js'),path.join(out,'tv-iptv.js'));
fs.copyFileSync(path.join(root,'webos/tv-features.js'),path.join(out,'tv-features.js'));
fs.copyFileSync(path.join(root,'webos/tv-profiles.js'),path.join(out,'tv-profiles.js'));
fs.copyFileSync(path.join(root,'webos/tv-posters.js'),path.join(out,'tv-posters.js'));
fs.copyFileSync(path.join(root,'webos/tv-home.js'),path.join(out,'tv-home.js'));
fs.copyFileSync(path.join(root,'webos/tv-keyboard.js'),path.join(out,'tv-keyboard.js'));
fs.copyFileSync(path.join(root,'webos/tv-alt-player.js'),path.join(out,'tv-alt-player.js'));
fs.copyFileSync(path.join(root,'webos/tv-lg-media.js'),path.join(out,'tv-lg-media.js'));
fs.copyFileSync(path.join(root,'webos/lg-media-config.js'),path.join(out,'lg-media-config.js'));
fs.copyFileSync(path.join(root,'webos/tv.css'),path.join(out,'tv.css'));
fs.copyFileSync(path.join(root,'webos/tv-layout.css'),path.join(out,'tv-layout.css'));
const file=path.join(out,'index.html');let html=fs.readFileSync(file,'utf8');html=html.replace('</head>','<link rel="stylesheet" href="./tv.css" /></head>').replace('</body>','<script src="./tv-remote.js"></script></body>');// React başlamazsa siyah ekran yerine görülebilir hata kodu göster.
const diagnostic = `<script>(function(){var status='Başlatılıyor';function show(msg){var el=document.getElementById('webos-startup-error');if(!el){el=document.createElement('div');el.id='webos-startup-error';el.style.cssText='position:fixed;z-index:2147483647;inset:0;background:#12171f;color:white;padding:8vw;font:24px sans-serif;overflow:auto';document.body.appendChild(el);}el.textContent='XIPTV Play TV v0.1.1 — Açılış hatası: '+msg;}window.addEventListener('error',function(e){status=(e.message||'Kaynak yükleme hatası')+' '+(e.filename||'');show(status);});window.addEventListener('unhandledrejection',function(e){status=String(e.reason||'Bilinmeyen hata');show(status);});setTimeout(function(){var root=document.getElementById('root');if(!root||!root.children.length)show(status==='Başlatılıyor'?'Uygulama ekranı oluşmadı; TV tarayıcı uyumluluğu veya JS yükleme hatası':status);},9000);})();</script>`;
html=html.replace('<script type="module"', diagnostic+'<script type="module"');
if(process.env.WEBOS_LEGACY === 'true') html=fs.readFileSync(path.join(root,'webos/legacy-index.html'),'utf8');
fs.writeFileSync(file,html);
// Harici görsel araçlara gerek olmadan 80x80 RGB PNG simgesi.
const w=80,h=80,raw=Buffer.alloc(h*(1+w*3));for(let y=0;y<h;y++)for(let x=0;x<w;x++){let i=y*(1+w*3)+1+x*3;let on=x>24&&x<61&&Math.abs(y-40)<(x-24)*0.64;raw[i]=on?0:14;raw[i+1]=on?240:28;raw[i+2]=on?255:38;}
function crc(b){let c=0xffffffff;for(const n of b){c^=n;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(t,b){let tag=Buffer.from(t),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(b.length);sum.writeUInt32BE(crc(Buffer.concat([tag,b])));return Buffer.concat([len,tag,b,sum]);}
let hdr=Buffer.alloc(13);hdr.writeUInt32BE(w);hdr.writeUInt32BE(h,4);hdr[8]=8;hdr[9]=2;
fs.writeFileSync(path.join(out,'icon.png'),Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',hdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
console.log('webOS paket dizini:',out);
