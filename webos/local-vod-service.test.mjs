import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import createRelay from '../webos-vod-service/relay.js';

test('TV loopback plays a redirected VOD manifest, variant, key and ranged .txt segment',async t=>{
 const upstream = http.createServer((req,res)=>{
  switch(req.url){
   case '/movie/9.mp4':
    res.writeHead(302,{Location:'/cdn/index.m3u8?token=movie'});break;
   case '/cdn/index.m3u8?token=movie':
    res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=450000\nv/video.m3u8');return;
   case '/cdn/v/video.m3u8':
    res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../k?id=99"\n#EXTINF:4,\nseg.txt?id=11\n#EXT-X-ENDLIST');return;
   case '/cdn/k?id=99':
    res.end(Buffer.alloc(16,2));return;
   case '/cdn/v/seg.txt?id=11':
    assert.equal(req.headers.range,'bytes=0-187');
    res.writeHead(206,{'Content-Type':'text/plain','Content-Range':'bytes 0-187/376','Content-Length':188});
    res.end(Buffer.alloc(188,0x47));return;
   default: res.writeHead(404);
  }
  res.end();
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 t.after(()=>upstream.close());
 const events=[];
 let relay;
 const local=await new Promise(resolve=>{
  relay=createRelay('http://127.0.0.1:'+upstream.address().port+'/movie/9.mp4',event=>{
   events.push(event.stage);if(event.url)resolve(event.url);
  });
 });
 t.after(()=>relay.close());
 const top=await (await fetch(local)).text();
 const child=new URL(top.split('\n').at(-1),local);
 assert.match(child.pathname,/\.m3u8$/);
 const playlist=await (await fetch(child)).text();
 assert.doesNotMatch(playlist,/id=|cdn|seg\.txt/);
 const key=new URL(playlist.match(/URI="([^"]+)"/)[1],local);
 assert.equal((await (await fetch(key)).arrayBuffer()).byteLength,16);
 const media=new URL(playlist.split('\n').find(line=>line.endsWith('.ts')),local);
 const segment=await fetch(media,{headers:{Range:'bytes=0-187'}});
 assert.equal(segment.status,206);
 assert.equal(segment.headers.get('content-type'),'video/mp2t');
 assert.equal(segment.headers.get('content-range'),'bytes 0-187/376');
 assert.equal(new Uint8Array(await segment.arrayBuffer())[0],0x47);
 assert.ok(events.includes('media-bytes'));
 assert.equal((await fetch(new URL('/unlisted',local))).status,404);
});
