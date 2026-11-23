import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
const {safeIp,normalizeStreams,sourcePath,probeArgs,parseProbePayload,isXtreamAuthorized,validateHost,compatibilityArgs,shouldBypassCrashedProbe,mp4ClipArgs,parseByteRange,rewriteHlsManifest,tvHlsAssetFormat,hasTsSync}=await import('./server.mjs');
test('blocks loopback, RFC1918 and link-local addresses',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.2.4','169.254.169.254','::1','fc00::2'])assert.equal(safeIp(ip),false,ip);
 assert.equal(safeIp('1.1.1.1'),true);
});
test('normalizes complete audio and subtitle stream indexes',()=>{
 const streams=normalizeStreams({streams:[{index:0,codec_type:'video'},{index:1,codec_type:'audio',codec_name:'aac',tags:{language:'tur'}},{index:2,codec_type:'audio',codec_name:'ac3',tags:{language:'eng'}},{index:3,codec_type:'subtitle',codec_name:'subrip',tags:{language:'tur'}},{index:4,codec_type:'subtitle',codec_name:'hdmv_pgs_subtitle',tags:{language:'eng'}}]});
 assert.deepEqual(streams.map(x=>x.index),[0,1,2,3,4]);
 assert.equal(streams[3].externalVtt,true);
 assert.equal(streams[4].externalVtt,false);
});
test('only permitted Xtream paths',()=>{
 assert.match(sourcePath({kind:'series',id:'1234',username:'user',password:'pass',extension:'mkv'},'https://iptv.example'),/\/series\/user\/pass\/1234\.mkv$/);
 for(const type of ['live','../../etc'])assert.throws(()=>sourcePath({kind:type,id:'123',username:'u',password:'p'},'https://iptv.example'));
 assert.throws(()=>sourcePath({kind:'movie',id:'../a',username:'u',password:'p'},'https://iptv.example'));
});
test('probe uses bounded analysis and JSON metadata',()=>{
 let args=probeArgs('https://host.invalid/movie/u/p/1.mkv');
 assert.ok(args.includes('-probesize'));assert.ok(args.includes('-analyzeduration'));
 assert.equal(args.at(-1),'https://host.invalid/movie/u/p/1.mkv');
});

test('automatically accepts an active Xtream account on a new public server',async()=>{
 const called=[];
 const mock={
  lookup:async(host)=>{assert.equal(host,'updated-iptv.example');return [{address:'8.8.8.8'}];},
  fetch:async(url,options)=>{
   const parsed=new URL(url);
   assert.equal(parsed.hostname,'updated-iptv.example');
   assert.equal(parsed.pathname,'/player_api.php');
   assert.equal(parsed.searchParams.get('username'),'sample-user');
   assert.equal(parsed.searchParams.get('password'),'sample-pass');
   assert.equal(options.redirect,'manual');
   called.push(1);
   return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({user_info:{auth:1,status:'Active'}})};
  }
 };
 assert.equal(await validateHost('http://updated-iptv.example:8080',{username:'sample-user',password:'sample-pass'},mock),'http://updated-iptv.example:8080');
 assert.equal(called.length,1);
});
test('does not accept expired accounts or redirects as host authorization',async()=>{
 const mock={
  lookup:async()=>[{address:'8.8.4.4'}],
  fetch:async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({user_info:{auth:1,status:'Expired'}})})
 };
 assert.equal(isXtreamAuthorized({user_info:{auth:'1',status:'Active'}}),true);
 assert.equal(isXtreamAuthorized({user_info:{auth:1,status:'Expired'}}),false);
 await assert.rejects(validateHost('http://another.example:8080',{username:'u',password:'p'},mock),/Xtream hesabı aktif değil/);
 mock.fetch=async()=>({ok:false,status:302});
 await assert.rejects(validateHost('http://another.example:8080',{username:'u',password:'p'},mock),/Xtream hesabı/);
});
test('forbids private or loopback DNS even with active Xtream credentials',async()=>{
 const mock={
  lookup:async()=>[{address:'127.0.0.1'}],
  fetch:async()=>{throw Error('must not verify private DNS');}
 };
 await assert.rejects(validateHost('http://internal.example:8080',{username:'u',password:'p'},mock),/özel ağa/);
 await assert.rejects(validateHost('http://internal.example:8080/path',{username:'u',password:'p'},mock),/geçersiz/);
});

test('parses genuine ffprobe stream JSON, including Turkish audio and subtitle',()=>{
 const data=parseProbePayload('\uFEFF  '+JSON.stringify({streams:[
  {index:0,codec_type:'video',codec_name:'h264'},
  {index:1,codec_type:'audio',codec_name:'aac',tags:{language:'eng'}},
  {index:2,codec_type:'audio',codec_name:'aac',tags:{language:'tur'}},
  {index:3,codec_type:'subtitle',codec_name:'subrip',tags:{language:'tur'}}
 ]})+'\n');
 const tracks=normalizeStreams(data);
 assert.deepEqual(tracks.map(x=>x.language),['und','eng','tur','tur']);
});
test('recovers trailing FFprobe output but rejects non-stream JSON',()=>{
 const value=parseProbePayload('notices\n{"streams":[{"index":2,"codec_type":"audio","codec_name":"ac3"}]}\n');
 assert.equal(normalizeStreams(value)[0].index,2);
 assert.throws(()=>parseProbePayload(''),/boş çıktı/);
 assert.throws(()=>parseProbePayload('<html>unauthorized</html>'),/JSON yerine geçersiz veri/);
 assert.throws(()=>parseProbePayload('{"error":"unauthorized"}'),/akış listesini döndürmedi/);
});
test('two-pass FFprobe has bounded timeouts and full-stream fallback',()=>{
 const first=probeArgs('https://host.invalid/1.mkv');
 const second=probeArgs('https://host.invalid/1.mkv',true);
 assert.ok(first.includes('-show_entries'));
 assert.ok(second.includes('-show_streams'));
 assert.equal(first.includes('-max_redirects'),false);
 assert.equal(second.at(-1),'https://host.invalid/1.mkv');
});

test('compatibility transcoding uses bounded baseline H264 AAC TS without changing live TV',()=>{
 const args=compatibilityArgs('http://127.0.0.1:12345/valid-token',99999,2);
 assert.equal(args[args.indexOf('-ss')+1],'14400');
 assert.equal(args[args.indexOf('-map')+1],'0:v:0');
 assert.ok(args.includes('0:2'));
 assert.ok(args.includes('libx264'));
 assert.ok(args.includes('baseline'));
 assert.ok(args.includes('yuv420p'));
 assert.ok(args.includes('aac'));
 assert.ok(args.includes('mpegts'));
 assert.ok(Number(args[args.indexOf('-t')+1])<=300);
 assert.equal(args[args.length-1],'pipe:1');
 assert.equal(args.includes('-c:v'),true);
 assert.equal(args.includes('copy'),false);
});
test('video codec metadata is retained for TV compatibility decision',()=>{
 const tracks=normalizeStreams({streams:[{index:0,codec_type:'video',codec_name:'hevc',profile:'Main 10',width:3840,height:2160},{index:1,codec_type:'audio',codec_name:'eac3'}]});
 assert.equal(tracks[0].codec,'hevc');assert.equal(tracks[0].profile,'Main 10');
 assert.equal(tracks[0].width,3840);assert.equal(tracks[0].height,2160);
 assert.equal(tracks[1].codec,'eac3');
});

test('only authenticated video media may bypass a SIGSEGV ffprobe crash',()=>{
 const ticket={lastStatus:200,lastType:'video/mp2t',lastError:''};
 assert.equal(shouldBypassCrashedProbe('Medya analizi başarısız: FFprobe sinyal SIGSEGV',ticket),true);
 assert.equal(shouldBypassCrashedProbe('FFprobe sinyal SIGSEGV',{...ticket,lastType:'video/x-matroska'}),true);
 assert.equal(shouldBypassCrashedProbe('FFprobe sinyal SIGSEGV',{...ticket,lastStatus:403}),false);
 assert.equal(shouldBypassCrashedProbe('FFprobe sinyal SIGSEGV',{...ticket,lastError:'upstream denied'}),false);
 assert.equal(shouldBypassCrashedProbe('FFprobe sinyal SIGSEGV',{...ticket,lastType:'text/html'}),false);
 assert.equal(shouldBypassCrashedProbe('FFprobe sinyal SIGSEGV',{...ticket,lastType:'application/octet-stream'}),false);
 assert.equal(shouldBypassCrashedProbe('FFprobe timeout',ticket),false);
});

test('MP4 trial encodes a completed faststart file instead of streaming MPEG-TS',()=>{
 const args=mp4ClipArgs('http://127.0.0.1:12345/ticket','/tmp/test.mp4',0,null);
 assert.ok(args.includes('libx264'));
 assert.ok(args.includes('aac'));
 assert.ok(args.includes('+faststart'));
 assert.equal(args[args.lastIndexOf('-f')+1],'mp4');
 assert.equal(args[args.lastIndexOf('-t')+1],'8');
 assert.ok(!args.includes('mpegts'));
 assert.equal(args.at(-1),'/tmp/test.mp4');
});
test('byte range parser supports full file and bounded partial content',()=>{
 assert.deepEqual(parseByteRange(null,100),{start:0,end:99,status:200});
 assert.deepEqual(parseByteRange('bytes=0-9',100),{start:0,end:9,status:206});
 assert.deepEqual(parseByteRange('bytes=95-',100),{start:95,end:99,status:206});
 assert.deepEqual(parseByteRange('bytes=-10',100),{start:90,end:99,status:206});
 assert.equal(parseByteRange('bytes=100-120',100),null);
 assert.equal(parseByteRange('bytes=bad',100),null);
});

test('sourcePath permits authenticated VOD HLS but never live HLS through LG media',()=>{
 const location=sourcePath({kind:'movie',id:'42',extension:'m3u8',username:'a',password:'b'},'https://provider.example');
 assert.equal(location,'https://provider.example/movie/a/b/42.m3u8');
 assert.throws(()=>sourcePath({kind:'live',id:'42',extension:'m3u8',username:'a',password:'b'},'https://provider.example'));
});
test('rewrites HLS variants, media, encryption keys and subtitle URI attributes',()=>{
 const input=['#EXTM3U','#EXT-X-VERSION:3','#EXT-X-KEY:METHOD=AES-128,URI="../secure/key.bin"',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",URI="subtitle.m3u8"',
  '#EXTINF:6.0,','seg0.ts',
  '#EXT-X-STREAM-INF:BANDWIDTH=1500000','https://cdn.example/video/variant.m3u8',
  '#EXT-X-ENDLIST'].join('\n');
 const links=[];
 const out=rewriteHlsManifest(input,'https://provider.example/hls/list/master.m3u8',(address)=>{
  links.push(address);return 'http://127.0.0.1:3101/'+String(links.length).padStart(48,'a')+'/media.ts';
 });
 assert.deepEqual(links,['https://provider.example/hls/secure/key.bin',
  'https://provider.example/hls/list/subtitle.m3u8',
  'https://provider.example/hls/list/seg0.ts',
  'https://cdn.example/video/variant.m3u8']);
 assert.equal(out.includes('https://provider.example'),false);
 assert.equal(out.includes('https://cdn.example'),false);
 assert.equal((out.match(/127.0.0.1/g)||[]).length,4);
});
test('HLS rewrite rejects non-manifests, unsafe protocols, and embedded credentials',()=>{
 assert.throws(()=>rewriteHlsManifest('not HLS','https://example.org/a.m3u8',()=>''),/HLS oynatma listesi geçersiz/);
 assert.throws(()=>rewriteHlsManifest('#EXTM3U\nfile:///etc/passwd','https://example.org/a.m3u8',()=>''),/HLS medya protokolü/);
 assert.throws(()=>rewriteHlsManifest('#EXTM3U\ndata:text/plain,payload','https://example.org/a.m3u8',()=>''),/HLS medya protokolü/);
 assert.throws(()=>rewriteHlsManifest('#EXTM3U\nhttps://user:pass@host.example/a.ts','https://example.org/a.m3u8',()=>''),/HLS medya protokolü/);
});
test('provider HLS aliases preserve variant, segment, key and subtitle roles',()=>{
 const input='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlevel.txt\n#EXT-X-KEY:METHOD=AES-128,URI="key.txt"\n#EXTINF:5,\n../segments/chunk.txt?token=example\n#EXTINF:5,\nsubtitle.vtt\n#EXT-X-ENDLIST\n';
 const manifest=rewriteHlsManifest(input,'http://provider.example/hls/master.m3u8',(url,pathname,kind)=>{
  assert.match(url,/^http:\/\/provider\.example\//);
  return kind+'.'+tvHlsAssetFormat(pathname,kind).extension;
 });
 assert.match(manifest,/playlist\.m3u8/);
 assert.match(manifest,/URI="asset\.txt"/);
 assert.match(manifest,/segment\.ts/);
 assert.match(manifest,/segment\.vtt/);
 assert.match(manifest,/#EXT-X-ENDLIST/);
 const ts=Buffer.alloc(564);
 ts[0]=ts[188]=ts[376]=0x47;
 assert.equal(hasTsSync(ts),true);
 assert.equal(hasTsSync(Buffer.from('<html>Access denied</html>')),false);
 ts[188]=0;
 assert.equal(hasTsSync(ts),false);
});
