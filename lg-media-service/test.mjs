import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
const {safeIp,normalizeStreams,sourcePath,probeArgs,parseProbePayload,isXtreamAuthorized,validateHost,compatibilityArgs}=await import('./server.mjs');
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
