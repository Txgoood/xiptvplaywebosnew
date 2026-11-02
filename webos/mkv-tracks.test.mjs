import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Load the ES5 browser module into a minimal sandbox.
const code=fs.readFileSync(new URL('./tv-mkv-tracks.js',import.meta.url),'utf8');
const sandbox={document:{getElementById(){return null;}},XMLHttpRequest:function(){},setTimeout,clearTimeout};
sandbox.window=sandbox;
vm.createContext(sandbox);
new vm.Script(code,{filename:'tv-mkv-tracks.js'}).runInContext(sandbox);
const mkv=sandbox.XIPTVMkv;
assert.equal(typeof mkv.parseHead,'function');

// ---- tiny Matroska writer ----
function size(n){
  if(n<127)return Buffer.from([0x80|n]);
  const b=Buffer.alloc(4);b.writeUInt32BE(n);b[0]|=0x10;return b;
}
function el(idHex,payload){
  const id=Buffer.from(idHex,'hex'),body=Buffer.isBuffer(payload)?payload:Buffer.from(payload);
  return Buffer.concat([id,size(body.length),body]);
}
const uint=(idHex,n)=>el(idHex,Buffer.from([n]));
const str=(idHex,s)=>el(idHex,Buffer.from(s,'utf8'));
function entry(opts){
  const parts=[uint('D7',opts.number),uint('83',opts.type)];
  if(opts.lang)parts.push(str('22B59C',opts.lang));
  if(opts.name)parts.push(str('536E',opts.name));
  parts.push(str('86',opts.codec));
  if(opts.def!==undefined)parts.push(uint('88',opts.def));
  if(opts.forced)parts.push(uint('55AA',1));
  if(opts.channels)parts.push(el('E1',uint('9F',opts.channels)));
  return el('AE',Buffer.concat(parts));
}
const tracksEl=el('1654AE6B',Buffer.concat([
  entry({number:1,type:1,codec:'V_MPEG4/ISO/AVC'}),
  entry({number:2,type:2,lang:'tur',name:'Dublaj',codec:'A_AC3',channels:6,def:1}),
  entry({number:3,type:2,lang:'eng',codec:'A_EAC3',channels:2,def:0}),
  entry({number:4,type:0x11,lang:'tur',name:'Türkçe Altyazı',codec:'S_TEXT/UTF8',def:0}),
  entry({number:5,type:0x11,lang:'eng',codec:'S_HDMV/PGS',forced:true}),
]));
const ebmlHeader=el('1A45DFA3',str('4282','matroska'));
const cluster=el('1F43B675',Buffer.alloc(300,7));
const unknownSegment=body=>Buffer.concat([Buffer.from('18538067','hex'),Buffer.from([0x01,0xff,0xff,0xff,0xff,0xff,0xff,0xff]),body]);

// 1) Tracks directly after SeekHead/Info inside an unknown-size Segment.
{
  const seekHead=el('114D9B74',el('4DBB',Buffer.concat([el('53AB',Buffer.from('1654AE6B','hex')),el('53AC',Buffer.from([0x40]))])));
  const info=el('1549A966',str('4D80','xiptv-test'));
  const file=Buffer.concat([ebmlHeader,unknownSegment(Buffer.concat([seekHead,el('EC',Buffer.alloc(40)),info,tracksEl,cluster]))]);
  const result=mkv.parseHead(file);
  assert.ok(result.tracks,'tracks must be returned from the first buffer');
  assert.equal(result.tracks.length,4);
  const audio=result.tracks.filter(t=>t.kind==='audio'),subs=result.tracks.filter(t=>t.kind==='subtitle');
  assert.equal(audio.length,2);assert.equal(subs.length,2);
  assert.equal(audio[0].lang,'tur');assert.equal(audio[0].name,'Dublaj');assert.equal(audio[0].codec,'A_AC3');
  assert.equal(audio[0].channels,6);assert.equal(audio[0].def,true);assert.equal(audio[0].typeIndex,0);
  assert.equal(audio[1].lang,'eng');assert.equal(audio[1].typeIndex,1);assert.equal(audio[1].def,false);
  assert.equal(subs[0].name,'Türkçe Altyazı','UTF-8 track names must be decoded');
  assert.equal(subs[0].typeIndex,0);assert.equal(subs[1].typeIndex,1);assert.equal(subs[1].forced,true);
  // The same bytes as a binary string (what the x-user-defined XHR returns) must parse identically.
  const asString=file.toString('latin1');
  assert.equal(mkv.parseHead(asString).tracks.length,4);
  // x-user-defined maps bytes >= 0x80 to U+F780..U+F7FF; the reader masks with 255.
  const mapped=Array.from(file).map(b=>String.fromCharCode(b>=0x80?0xF700+b:b)).join('');
  assert.equal(mkv.parseHead(mapped).tracks.length,4);
}

// 2) Tracks beyond the first buffer: SeekHead points to it, second fetch parses at offset 0.
{
  const void1=el('EC',Buffer.alloc(3000));
  const placeholderSeek=pos=>el('114D9B74',el('4DBB',Buffer.concat([el('53AB',Buffer.from('1654AE6B','hex')),el('53AC',Buffer.from([pos>>8,pos&255]))])));
  // Segment data starts right after EBML header + segment id/size; seek position is relative to it.
  const seekLen=placeholderSeek(0).length;
  const seekHead=placeholderSeek(seekLen+void1.length);
  const body=Buffer.concat([seekHead,void1,tracksEl,cluster]);
  const file=Buffer.concat([ebmlHeader,unknownSegment(body)]);
  const truncated=file.subarray(0,800);                       // does not contain Tracks
  const first=mkv.parseHead(truncated);
  assert.equal(first.tracks,undefined);
  const segData=file.length-body.length;
  assert.equal(first.need,segData+seekLen+void1.length,'must point at the Tracks element');
  const second=mkv.parseTracksAt(file.subarray(first.need,first.need+4096));
  assert.equal(second.tracks.length,4);
  assert.equal(mkv.parseTracksAt(file.subarray(first.need,first.need+20)).error,'tracks-too-large');
}

// 3) Not a Matroska file / no tracks.
assert.equal(mkv.parseHead(Buffer.from('this is an mp4 or mpeg-ts stream, not mkv')).error,'not-mkv');
assert.equal(mkv.parseHead('').error,'not-mkv');
{
  const onlyCluster=Buffer.concat([ebmlHeader,unknownSegment(cluster)]);
  const none=mkv.parseHead(onlyCluster);
  assert.ok(Array.isArray(none.tracks)&&none.tracks.length===0);
}

// 4) Header is read BEFORE playback (single-connection IPTV accounts), and playback always starts.
function fakeXhr(responder){
  return function FakeXHR(){
    const self=this;self.headers={};
    self.open=(m,u)=>{self.url=u;};
    self.overrideMimeType=()=>{};
    self.setRequestHeader=(k,v)=>{self.headers[k]=v;};
    self.abort=()=>{self.aborted=true;};
    self.send=()=>setImmediate(()=>{const r=responder(self);self.status=r.status;self.responseText=r.text;if(self.onload)self.onload();});
  };
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const statusEl={textContent:''};let refreshed=0;
sandbox.document.getElementById=id=>id==='tv-mkv-status'?statusEl:null;
sandbox.XIPTVTV={refreshTracks(){refreshed++;}};
const sample=Buffer.concat([ebmlHeader,unknownSegment(Buffer.concat([tracksEl,cluster]))]);
{
  const order=[];
  sandbox.XMLHttpRequest=fakeXhr(x=>{order.push('xhr '+x.headers.Range);return {status:206,text:sample.toString('latin1')};});
  const deferred=mkv.setSource({url:'http://iptv.example:80/series/u/p/1.mkv',extension:'mkv'},()=>order.push('play'));
  assert.equal(deferred,true,'MKV must defer playback until the header is read');
  assert.equal(order.length,0,'nothing may start synchronously');
  await wait(700);
  assert.equal(order[0],'xhr bytes=0-786431');
  assert.equal(order[1],'play','playback starts only after the header request finished');
  assert.equal(order.length,2);
  assert.equal(mkv.tracks().length,4);
  assert.ok(refreshed>=1,'menus must be refreshed');
  assert.match(statusEl.textContent,/2 ses, 2 altyazı/);
}
{
  const order=[];
  sandbox.XMLHttpRequest=fakeXhr(()=>({status:404,text:'<html><body>Not Found</body></html>'}));
  mkv.setSource({url:'http://iptv.example:80/series/u/p/2.mkv',extension:'mkv'},()=>order.push('play'));
  await wait(700);
  assert.deepEqual(Array.from(order),['play'],'playback must still start when the header cannot be read');
  assert.equal(mkv.tracks().length,0);
  assert.match(statusEl.textContent,/HTTP 404/);
  assert.match(statusEl.textContent,/iptv\.example/);
  assert.match(statusEl.textContent,/Not Found/);
  assert.ok(!/u\/p/.test(statusEl.textContent),'credentials must never be shown on screen');
}
{
  const order=[];
  sandbox.XMLHttpRequest=fakeXhr(()=>({status:206,text:sample.toString('latin1')}));
  assert.equal(mkv.setSource({url:'http://iptv.example/movie/u/p/3.mp4',extension:'mp4'},()=>order.push('mp4')),false);
  assert.equal(mkv.setSource(null,()=>order.push('live')),false);
  await wait(500);
  assert.equal(order.length,0,'non-MKV: the caller starts playback itself, callback is never used');
}
{
  const order=[];
  sandbox.XMLHttpRequest=fakeXhr(()=>({status:206,text:sample.toString('latin1')}));
  mkv.setSource({url:'http://iptv.example/series/u/p/4.mkv',extension:'mkv'},()=>order.push('first'));
  mkv.setSource({url:'http://iptv.example/series/u/p/5.mkv',extension:'mkv'},()=>order.push('second'));
  await wait(700);
  assert.deepEqual(Array.from(order),['second'],'a replaced selection must never start the old stream');
}

// 5) Track selection through the TV media pipeline (luna). The bridge is detected by truthiness,
//    because old WebKit reports typeof 'object' for host constructors.
const fakeVideo={mediaId:'pipe-1',paused:false,ended:false,currentTime:10};
sandbox.document.getElementById=id=>id==='video'?fakeVideo:id==='tv-mkv-status'?statusEl:null;
const calls=[];let replyFor=()=>({returnValue:true});
sandbox.PalmServiceBridge=function(){
  const self=this;
  this.call=(uri,json)=>{const params=JSON.parse(json);calls.push({uri,params});setImmediate(()=>self.onservicecallback(JSON.stringify(replyFor(uri,params))));};
  this.cancel=()=>{};
};
{
  // state from block 4: 2 audio tracks, default audio index 0
  calls.length=0;
  mkv.choose('audio',1);
  await wait(60);
  assert.equal(calls[0].uri,'luna://com.webos.media/selectTrack');
  assert.deepEqual({...calls[0].params},{mediaId:'pipe-1',type:'audio',index:1});
  assert.match(statusEl.textContent,/Ses parçası değiştirildi/);
  // playback never advances (currentTime fixed) -> automatic rollback to the previous audio track
  await wait(4800);
  assert.equal(calls.length,2,'rollback must call selectTrack again');
  assert.deepEqual({...calls[1].params},{mediaId:'pipe-1',type:'audio',index:0});
  assert.match(statusEl.textContent,/önceki ses parçasına dönüldü/);
}
{
  // subtitles: 'text' rejected, 'subtitle' accepted, then best-effort enable
  calls.length=0;
  replyFor=(uri,p)=>uri.endsWith('/selectTrack')&&p.type==='text'?{returnValue:false,errorText:'bad type'}:{returnValue:true};
  mkv.choose('subtitle',1);
  await wait(120);
  assert.deepEqual(calls.map(c=>c.uri.split('/').pop()),['selectTrack','selectTrack','setSubtitleEnable']);
  assert.equal(calls[0].params.type,'text');assert.equal(calls[1].params.type,'subtitle');
  assert.equal(calls[1].params.index,1);
  assert.equal(calls[2].params.enable,true);
  assert.match(statusEl.textContent,/Altyazı seçildi/);
  // turning subtitles off after selecting one
  calls.length=0;replyFor=()=>({returnValue:true});
  mkv.subtitleOff();
  await wait(60);
  assert.equal(calls[0].uri.split('/').pop(),'setSubtitleEnable');
  assert.equal(calls[0].params.enable,false);
  assert.match(statusEl.textContent,/Altyazı kapatıldı/);
}
{
  // rejected by the TV: the real error is shown on screen
  calls.length=0;
  replyFor=()=>({returnValue:false,errorText:'invalid index',errorCode:-1});
  mkv.choose('subtitle',0);
  await wait(120);
  assert.match(statusEl.textContent,/kabul etmedi: invalid index/);
}
{
  // no bridge at all: message lists what exists, so the next screenshot is conclusive
  delete sandbox.PalmServiceBridge;
  mkv.choose('subtitle',0);
  await wait(60);
  assert.match(statusEl.textContent,/köprü/);
  assert.match(statusEl.textContent,/PalmServiceBridge=undefined/);
}

// 6) netcast package: no bridge at all -> the message explains why and what to install.
{
  assert.equal(sandbox.PalmServiceBridge,undefined);
  mkv.choose('audio',0);
  await wait(60);
  assert.match(statusEl.textContent,/netcast/);
  assert.match(statusEl.textContent,/XIPTV Play Native/);
}

// 7) Native package: the track list comes from the TV pipeline when the header cannot be read (CORS).
{
  const stream=(language,codec_name,extra)=>({language,codec_name,...extra});
  const pipelineReply={returnValue:true,data:JSON.stringify({sourceInfo:{
    audio_streams:[stream('eng','ac3',{channels:6}),stream('tur','ac3',{channels:6})],
    subtitle_streams:[stream('tur','subrip'),stream('eng','subrip'),stream('fre','hdmv_pgs_subtitle')]}})};
  const parsed=mkv.parsePipeline(pipelineReply);
  assert.equal(parsed.length,5);
  assert.equal(parsed.filter(t=>t.kind==='audio').length,2);
  assert.equal(parsed.filter(t=>t.kind==='subtitle').length,3);
  assert.equal(parsed[1].lang,'tur');assert.equal(parsed[1].typeIndex,1);
  assert.equal(parsed[2].kind,'subtitle');assert.equal(parsed[2].typeIndex,0);
  // alternative shapes: object payload, and streams nested under programs[0]
  assert.equal(mkv.parsePipeline({data:{sourceInfo:{audio_streams:[{language:'tur'}]}}}).length,1);
  assert.equal(mkv.parsePipeline({data:JSON.stringify({sourceInfo:{programs:[{audio_streams:[{language:'a'}],subtitle_streams:[{language:'b'}]}]}})}).length,2);
  assert.equal(mkv.parsePipeline({returnValue:true}).length,0);

  sandbox.PalmServiceBridge=function(){
    const self=this;
    this.call=(uri,json)=>{calls.push({uri,params:JSON.parse(json)});setImmediate(()=>self.onservicecallback(JSON.stringify(replyFor(uri,JSON.parse(json)))));};
    this.cancel=()=>{};
  };
  sandbox.XMLHttpRequest=fakeXhr(()=>({status:0,text:''}));    // header read fails (CORS)
  let started=false;
  mkv.setSource({url:'http://iptv.example/series/u/p/9.mkv',extension:'mkv'},()=>{started=true;});
  await wait(700);
  assert.equal(started,true);
  assert.equal(mkv.tracks().length,0);
  calls.length=0;
  replyFor=uri=>uri.endsWith('/getPipelineState')?pipelineReply:{returnValue:true};
  mkv.rescan();                                              // the "yeniden oku" button
  await wait(80);
  assert.equal(calls[0].uri,'luna://com.webos.media/getPipelineState');
  assert.deepEqual({...calls[0].params},{mediaId:'pipe-1'});
  assert.equal(mkv.tracks().length,5);
  assert.match(statusEl.textContent,/TV medya motorundan 2 ses, 3 altyazı/);
  // an unreadable answer shows the raw response so the structure can be diagnosed
  replyFor=()=>({returnValue:true,data:'{"unknown":1}'});
  mkv.rescan();
  await wait(80);
  assert.match(statusEl.textContent,/parça listesi vermedi\. Yanıt:/);
  assert.match(statusEl.textContent,/unknown/);
}

console.log('PASS: MKV header reader (unknown-size segment, seekhead jump, UTF-8 names, x-user-defined strings, non-mkv) + header-before-playback ordering + luna track selection/rollback/off + netcast message + pipeline track list');
