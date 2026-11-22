import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const source = fs.readFileSync(new URL('./tv-ai-engine.js', import.meta.url), 'utf8');
const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const hasFfmpeg = spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status === 0;
const bin = (buf) => buf.toString('latin1');
const eq = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

/* ------------------------------------------------------------------ environment */
function makeEnv({ provider, behave, video: videoOpts } = {}) {
  let now = 0, seq = 0;
  const timers = [];
  const setTimeout_ = (fn, ms) => { const t = { id: ++seq, at: now + (ms || 0), fn, every: 0 }; timers.push(t); return t.id; };
  const setInterval_ = (fn, ms) => { const t = { id: ++seq, at: now + ms, fn, every: ms }; timers.push(t); return t.id; };
  const clear = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      now = t.at;
      if (t.every) t.at += t.every; else timers.shift();
      t.fn();
    }
    now = end;
  }
  const handlers = {};
  const video = {
    src: '', currentTime: 0, error: null, paused: false, attempts: [],
    addEventListener(n, f) { (handlers[n] = handlers[n] || []).push(f); },
    removeEventListener(n, f) { handlers[n] = (handlers[n] || []).filter((x) => x !== f); },
    emit(n) { (handlers[n] || []).slice().forEach((f) => f()); },
    pause() { this.paused = true; },
    play() { this.paused = false; return undefined; },
    removeAttribute(a) { if (a === 'src') this.src = ''; },
    load() {
      this.error = null; this.currentTime = 0;
      if (!this.src) return;
      const src = this.src, ext = (/\.([a-z0-9]+)$/i.exec(src) || [])[1];
      this.attempts.push(src);
      const mode = (behave || {})[(/^https:/.test(src) ? 's' : 'p') + ':' + ext] || (behave || {})[ext] || 'silent';
      if (mode === 'error') setTimeout_(() => { if (video.src === src) { video.error = { code: 4 }; video.emit('error'); } }, 300);
      if (mode === 'play') {
        setTimeout_(() => { if (video.src === src) { video.currentTime = 1; video.emit('timeupdate'); } }, 500);
        setTimeout_(() => { if (video.src === src) { video.currentTime = 2.2; video.emit('timeupdate'); } }, 1500);
      }
    },
    ...videoOpts
  };
  const children = [];
  const diag = { textContent: '' };
  const anchor = { parentNode: { insertBefore(el) { children.push(el); } }, nextSibling: null };
  const overlays = [];
  const document = {
    body: { appendChild(el) { overlays.push(el); } },
    getElementById(id) { return id === 'video' ? video : id === 'tv-vod-diagnose' ? anchor : id === 'tv-vod-diagnostics' ? diag : null; },
    createElement() { return { style: {}, textContent: '' }; }
  };
  class XHR {
    open(m, url) { this.url = url; this.headers = {}; }
    setRequestHeader(k, v) { this.headers[k.toLowerCase()] = v; }
    overrideMimeType() {}
    getResponseHeader(k) { return (this.resHeaders || {})[k.toLowerCase()] || null; }
    abort() { this.aborted = true; }
    send() {
      setTimeout_(() => {
        if (this.aborted) return;
        const r = provider ? provider(this.url) : null;
        if (!r) { this.status = 0; if (this.onerror) this.onerror(); return; }
        const body = Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body || '');
        let slice = body, status = r.status, range = this.headers.range, cr = null;
        if (status === 200 && range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (m && m[1] !== '' ) { const a = Number(m[1]), b = m[2] === '' ? body.length - 1 : Number(m[2]); slice = body.subarray(a, b + 1); status = 206; cr = `bytes ${a}-${a + slice.length - 1}/${body.length}`; }
          else if (m && m[1] === '' && m[2] !== '') { slice = body.subarray(Math.max(0, body.length - Number(m[2]))); status = 206; cr = `bytes ${body.length - slice.length}-${body.length - 1}/${body.length}`; }
        }
        this.status = status;
        this.resHeaders = { 'content-type': r.type || '', 'content-length': String(slice.length), 'accept-ranges': 'bytes' };
        if (cr) this.resHeaders['content-range'] = cr;
        this.responseText = bin(slice);
        this.readyState = 2;
        if (this.onreadystatechange) this.onreadystatechange();
        if (this.aborted) return;
        this.readyState = 4;
        if (this.onreadystatechange) this.onreadystatechange();
        if (this.onload) this.onload();
      }, 0);
    }
  }
  const store = new Map();
  const win = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    XIPTVLGMedia: { setSource() {} }, XIPTVVODRecovery: { start() { return true; } },
    XIPTVPlayerUI: { notices: [], notice(t) { this.notices.push(t); } },
    XIPTVPlaybackInfo: {}
  };
  win.document = document;
  const ctx = { window: win, document, XMLHttpRequest: XHR, setTimeout: setTimeout_, clearTimeout: clear, setInterval: setInterval_, clearInterval: clear, Buffer: undefined };
  vm.runInNewContext(source, ctx);
  return { win, video, advance, overlays, children, diag, store, engine: win.XIPTVAIEngine, timers };
}
const T = () => makeEnv().engine._test;

/* ------------------------------------------------------------------ synthetic stream builders */
function tsPacket(pid, payload, pusi = true) {
  const b = Buffer.alloc(188, 0xff);
  b[0] = 0x47; b[1] = (pusi ? 0x40 : 0) | ((pid >> 8) & 0x1f); b[2] = pid & 0xff; b[3] = 0x10;
  payload.copy(b, 4);
  return b;
}
function makeTs(streams) {
  const pat = Buffer.from([0x00, 0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe1, 0x00, 0, 0, 0, 0]);
  const es = [];
  for (const s of streams) {
    const d = s.desc || [];
    es.push(Buffer.from([s.type, 0xe1, s.pid & 0xff, 0xf0, d.length, ...d]));
  }
  const esBuf = Buffer.concat(es);
  const len = 9 + esBuf.length + 4;
  const pmt = Buffer.concat([Buffer.from([0x00, 0x02, 0xb0, len & 0xff, 0x00, 0x01, 0xc1, 0x00, 0x00, 0xe1, 0x01, 0xf0, 0x00]), esBuf, Buffer.alloc(4)]);
  return Buffer.concat([tsPacket(0, pat), tsPacket(0x100, pmt), tsPacket(0x101, Buffer.alloc(10), false), tsPacket(0x101, Buffer.alloc(10), false)]);
}
const mkv = (v, a) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('\x9fB\x86\x81\x01matroska' + '\x00'.repeat(40) + v + '\x00\x00' + a + '\x00\x00')]);

/* ------------------------------------------------------------------ pure parsers */
test('engine source stays ES5-safe for webOS 2 WebKit', () => {
  assert.equal(/=>|\blet\s|\bconst\s|`|\bclass\s|\.includes\(|\.startsWith\(|\.endsWith\(|\bPromise\b/.test(source), false);
  assert.equal(/^\s*'use strict'/m.test(source), true);
});

test('HLS parser reads master, media groups, byte-range, fMP4 and key tags', () => {
  const t = T();
  const master = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Turkce",LANGUAGE="tr",URI="a.m3u8"\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="a"\nv/720.m3u8\n';
  const m = t.parseHls(master);
  assert.equal(m.master, true); assert.equal(m.version, 6);
  assert.equal(m.media.length, 1); assert.equal(m.media[0].lang, 'tr');
  assert.equal(m.variants[0].codecs, 'avc1.64001f,mp4a.40.2'); assert.equal(m.variants[0].uri, 'v/720.m3u8');
  const media = t.parseHls('#EXTM3U\n#EXT-X-VERSION:4\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="k"\n#EXTINF:6,\n#EXT-X-BYTERANGE:100@0\ns0.m4s\n#EXTINF:6,\ns1.m4s\n#EXT-X-ENDLIST\n');
  assert.equal(media.master, false); assert.equal(media.segCount, 2); assert.equal(media.byteRange, true);
  assert.equal(media.map, true); assert.equal(media.keyMethod, 'SAMPLE-AES'); assert.equal(media.endlist, true);
  assert.equal(t.parseHls('<html>nope'), null);
  assert.equal(t.parseHls('﻿#EXTM3U\n#EXTINF:1,\na.ts\n').segCount, 1);
});

test('CODECS attribute is mapped, including H.264 profile/level and AAC Main', () => {
  const t = T();
  const r = t.codecNames('avc1.640028,mp4a.40.2,ec-3');
  eq(r.video.map((x) => x.n + ' ' + x.d), ['h264 High L4.0']);
  eq(r.audio.map((x) => x.n), ['aac', 'eac3']);
  assert.equal(t.codecNames('hvc1.2.4.L153.B0,mp4a.40.1').audio[0].d.includes('LG desteklemez'), true);
  assert.equal(t.codecNames('avc1.6e001f').video[0].d, 'High10 L3.1');
});

test('MPEG-TS PAT/PMT parsing identifies H.264/HEVC and AAC/AC3/E-AC3/DTS-in-private streams', () => {
  const t = T();
  const r = t.parseTs(bin(makeTs([{ type: 0x1b, pid: 0x101 }, { type: 0x0f, pid: 0x102 }, { type: 0x87, pid: 0x103 }, { type: 0x06, pid: 0x104, desc: [0x6a, 0x01, 0x00] }])));
  eq(r.video.map((x) => x.n), ['h264']);
  eq(r.audio.map((x) => x.n), ['aac', 'eac3', 'ac3']);
  assert.equal(t.parseTs(bin(makeTs([{ type: 0x24, pid: 0x101 }]))).video[0].n, 'hevc');
  assert.equal(t.parseTs('not a transport stream'), null);
  assert.equal(t.sniff(bin(makeTs([{ type: 0x1b, pid: 0x101 }]))), 'ts');
});

test('Matroska and MP4 scans work on synthetic headers', () => {
  const t = T();
  const m = t.scanMkv(bin(mkv('V_MPEG4/ISO/AVC', 'A_EAC3')));
  eq(m.video.map((x) => x.n), ['h264']); eq(m.audio.map((x) => x.n), ['eac3']);
  assert.equal(t.sniff(bin(mkv('V_VP9', 'A_AAC'))), 'mkv');
  const box = (type, body) => { const b = Buffer.alloc(8 + body.length); b.writeUInt32BE(b.length, 0); b.write(type, 4, 'latin1'); body.copy(b, 8); return b; };
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isomiso2'));
  const mdatFirst = Buffer.concat([ftyp, box('mdat', Buffer.alloc(64))]);
  const r1 = t.scanMp4(bin(mdatFirst));
  assert.equal(r1.moovAtEnd, true); assert.equal(r1.moovFront, false);
  const avc = Buffer.concat([Buffer.from('avc1'), Buffer.alloc(8), Buffer.from('avcC'), Buffer.from([1, 100, 0, 40])]);
  const moov = box('moov', Buffer.concat([avc, Buffer.from('mp4a')]));
  const r2 = t.scanMp4(bin(Buffer.concat([ftyp, moov, box('mdat', Buffer.alloc(8))])));
  assert.equal(r2.moovFront, true); assert.equal(r2.video[0].d, 'High L4.0'); assert.equal(r2.audio[0].n, 'aac');
  assert.equal(t.sniff(bin(ftyp)), 'mp4');
});

/* ------------------------------------------------------------------ real ffmpeg output */
const sample = (name, args) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-eng-'));
  const out = path.join(dir, name);
  const r = spawnSync(FFMPEG, ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', ...args, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { out, dir, data: fs.readFileSync(out) };
};
const skipFF = hasFfmpeg ? {} : { skip: 'ffmpeg not available' };

test('real ffmpeg: TS with H.264+AAC / HEVC+E-AC3 / H.264+AC3', skipFF, () => {
  const t = T();
  const a = t.parseTs(bin(sample('a.ts', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mpegts']).data.subarray(0, 98304)));
  eq([a.video[0].n, a.audio[0].n], ['h264', 'aac']);
  const b = t.parseTs(bin(sample('b.ts', ['-c:v', 'libx265', '-c:a', 'eac3', '-f', 'mpegts']).data.subarray(0, 98304)));
  eq([b.video[0].n, b.audio[0].n], ['hevc', 'eac3']);
  const c = t.parseTs(bin(sample('c.ts', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'ac3', '-f', 'mpegts']).data));
  eq([c.video[0].n, c.audio[0].n], ['h264', 'ac3']);
  assert.equal(t.decide({ container: 'ts', video: b.video, audio: b.audio }).verdict, 'native-ok');
});

test('real ffmpeg: MKV with AC3 passes, E-AC3 is flagged for audio transcode', skipFF, () => {
  const t = T();
  const ok = t.scanMkv(bin(sample('a.mkv', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'ac3']).data));
  eq([ok.video[0].n, ok.audio[0].n], ['h264', 'ac3']);
  assert.equal(t.decide({ container: 'mkv', video: ok.video, audio: ok.audio }).verdict, 'native-ok');
  const bad = t.scanMkv(bin(sample('b.mkv', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'eac3']).data));
  assert.equal(bad.audio[0].n, 'eac3');
  assert.equal(t.decide({ container: 'mkv', video: bad.video, audio: bad.audio }).verdict, 'transcode-audio');
});

test('real ffmpeg: MP4 faststart vs moov-at-end, HEVC, and 10-bit H.264', skipFF, () => {
  const t = T();
  const fast = sample('f.mp4', ['-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart']).data;
  const r = t.scanMp4(bin(fast.subarray(0, 98304)));
  assert.equal(r.moovFront, true); assert.equal(r.video[0].n, 'h264'); assert.equal(r.video[0].d, 'High L4.0'); assert.equal(r.audio[0].n, 'aac');
  assert.equal(t.decide({ container: 'mp4', video: r.video, audio: r.audio }).verdict, 'native-ok');
  const tailMp4 = sample('t.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']).data;
  const head = t.scanMp4(bin(tailMp4.subarray(0, 4096)));
  assert.equal(head.moovAtEnd, true);
  const tail = t.mp4Codecs(bin(tailMp4.subarray(tailMp4.length - 393216 > 0 ? tailMp4.length - 393216 : 0)));
  assert.equal(tail.video[0].n, 'h264');
  const hevc = t.scanMp4(bin(sample('h.mp4', ['-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart']).data));
  assert.equal(hevc.video[0].n, 'hevc'); assert.match(hevc.video[0].d, /^Main L/);
  const ten = t.scanMp4(bin(sample('x.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p10le', '-c:a', 'aac', '-movflags', '+faststart']).data));
  assert.match(ten.video[0].d, /^High10/);
  const d = t.decide({ container: 'mp4', video: ten.video, audio: ten.audio });
  assert.equal(d.verdict, 'transcode-video'); assert.match(d.reasons.join(' '), /10-bit/);
  const ac3mp4 = t.scanMp4(bin(sample('y.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'ac3', '-movflags', '+faststart', '-strict', '-2']).data));
  assert.equal(t.decide({ container: 'mp4', video: ac3mp4.video, audio: ac3mp4.audio }).verdict, 'transcode-audio');
});

test('real ffmpeg: HLS playlist + first TS segment are understood end to end', skipFF, () => {
  const t = T();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-hls-'));
  const r = spawnSync(FFMPEG, ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-g', '25', '-sc_threshold', '0', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod', path.join(dir, 'i.m3u8')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const pl = t.parseHls(fs.readFileSync(path.join(dir, 'i.m3u8'), 'utf8'));
  assert.equal(pl.master, false); assert.equal(pl.endlist, true); assert.ok(pl.segCount >= 2); assert.match(pl.segments[0], /\.ts$/);
  const ts = t.parseTs(bin(fs.readFileSync(path.join(dir, pl.segments[0]))));
  eq([ts.video[0].n, ts.audio[0].n], ['h264', 'aac']);
  const verdict = t.decide({ container: 'hls', hls: { media: [], byteRange: pl.byteRange, map: pl.map, keyMethod: pl.keyMethod }, video: ts.video, audio: ts.audio });
  assert.equal(verdict.verdict, 'native-ok');
});

/* ------------------------------------------------------------------ decision table */
test('decision table follows the LG webOS 2.0 list', () => {
  const t = T(), v = (n, d = '') => [{ n, d }];
  assert.equal(t.decide({ container: 'ts', video: v('h264'), audio: v('eac3') }).verdict, 'native-ok');
  assert.equal(t.decide({ container: 'mkv', video: v('hevc'), audio: v('eac3') }).verdict, 'transcode-audio');
  assert.equal(t.decide({ container: 'mkv', video: v('av1'), audio: v('aac') }).verdict, 'transcode-video');
  assert.equal(t.decide({ container: 'mp4', video: v('h264'), audio: v('aac', 'Main (LG desteklemez)') }).verdict, 'transcode-audio');
  assert.equal(t.decide({ container: 'mkv', video: v('h264'), audio: v('truehd') }).server, true);
  const hls = (h) => t.decide({ container: 'hls', hls: Object.assign({ media: [], byteRange: false, map: false, keyMethod: '' }, h), video: v('h264'), audio: v('aac') });
  assert.equal(hls({}).verdict, 'native-ok');
  assert.equal(hls({ media: [{ type: 'AUDIO' }] }).verdict, 'manifest-fix');
  assert.equal(hls({ byteRange: true }).verdict, 'manifest-fix');
  assert.equal(hls({ map: true }).verdict, 'manifest-fix');
  assert.equal(hls({ keyMethod: 'SAMPLE-AES' }).verdict, 'manifest-fix');
  assert.equal(hls({ keyMethod: 'AES-128' }).verdict, 'native-ok');
  assert.equal(t.decide({ container: 'unknown', video: [], audio: [] }).verdict, 'unknown');
  assert.equal(t.decide({ container: 'mkv', video: [], audio: [] }).verdict, 'unknown');
});

test('URL helpers: candidates, relative resolution, scheme swap, masking, encoding', () => {
  const t = T();
  eq(t.extensionCandidates('m3u8'), ['m3u8', 'mp4', 'mkv', 'ts']);
  eq(t.extensionCandidates('MKV'), ['mkv', 'mp4', 'ts', 'm3u8']);
  eq(t.extensionCandidates('../x'), ['mp4', 'mkv', 'ts', 'm3u8']);
  assert.equal(t.resolveUrl('https://h:8080/movie/u/p/1.m3u8?t=1', 'seg/0.ts'), 'https://h:8080/movie/u/p/seg/0.ts');
  assert.equal(t.resolveUrl('https://h:8080/movie/u/p/1.m3u8', '/hls/0.ts'), 'https://h:8080/hls/0.ts');
  assert.equal(t.resolveUrl('https://h/a/b.m3u8', 'http://cdn/x.ts'), 'http://cdn/x.ts');
  assert.equal(t.resolveUrl('https://h/a/b.m3u8', '//cdn/x.ts'), 'https://cdn/x.ts');
  assert.equal(t.swapScheme('https://h:8080'), 'http://h:8080');
  assert.equal(t.swapScheme('http://h:8080'), 'https://h:8080');
  assert.equal(t.maskHost('f02arbon.xyz:8080'), 'f02….xyz:8080');
  assert.equal(t.hostOf('https://user:pw@h.example:8080/a'), 'h.example:8080');
  assert.equal(t.buildUrl({ kind: 'movie', username: 'a b', password: 'p/q', id: '7' }, 'http://h:8080/', 'mkv'), 'http://h:8080/movie/a%20b/p%2Fq/7.mkv');
});

/* ------------------------------------------------------------------ learned rule memory */
test('learned rule applies only to the failing extension on that host and never stores secrets', () => {
  const e = makeEnv(), t = e.engine._test;
  assert.equal(e.engine.adjust('movie', 'https://h:8080', 'm3u8'), null);
  t.lkgRemember('movie', 'http://h:8080', 'mkv', 'm3u8');
  eq(e.engine.adjust('movie', 'https://h:8080', 'm3u8'), { server: 'http://h:8080', ext: 'mkv' });
  assert.equal(e.engine.adjust('movie', 'https://h:8080', 'mp4'), null, 'other titles keep their own extension');
  assert.equal(e.engine.adjust('series', 'https://h:8080', 'm3u8'), null, 'rule is scoped per kind');
  assert.equal(e.engine.adjust('movie', 'https://other:8080', 'm3u8'), null, 'rule is scoped per host');
  assert.equal(e.engine.adjust('live', 'https://h:8080', 'm3u8'), null, 'live TV is never adjusted');
  t.lkgForget('movie', 'https://h:8080');
  assert.equal(e.engine.adjust('movie', 'https://h:8080', 'm3u8'), null);
  t.lkgRemember('movie', 'http://h:8080', 'mkv', 'm3u8');
  const raw = [...e.store.values()].join('');
  assert.equal(/user|pass|password|@/i.test(raw.replace(/movie@/, '')), false);
  const stored = JSON.parse([...e.store.values()][0]);
  stored['movie@h:8080'].at = Date.now() - 31 * 24 * 3600 * 1000;
  e.store.set('xiptv_ai_lkg_v1', JSON.stringify(stored));
  assert.equal(e.engine.adjust('movie', 'https://h:8080', 'm3u8'), null, 'rule expires after 30 days');
});

/* ------------------------------------------------------------------ end-to-end flow with a fake provider and TV */
const SRV = 'https://prov.example:8080', U = 'U5ERNAME', P = 'P4SSWORD';
function ctxOf(kind = 'movie', ext = 'm3u8', server = SRV) {
  return { serverUrl: server, username: U, password: P, kind, id: '42', extension: ext, originalUrl: `${server}/${kind}/${U}/${P}/42.${ext}` };
}
const TS_OK = makeTs([{ type: 0x1b, pid: 0x101 }, { type: 0x0f, pid: 0x102 }]);
const HLS_MASTER = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="tr",LANGUAGE="tr",URI="a.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=900000,CODECS="avc1.640028,mp4a.40.2",AUDIO="a"\nv.m3u8\n';
const HLS_MEDIA = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\ns0.ts\n#EXT-X-ENDLIST\n';
function provider({ only, mkvOk = true, mp4Ok = false } = {}) {
  return (url) => {
    const m = /^(https?):\/\/[^/]+\/(movie|series)\/[^/]+\/[^/]+\/(.+)$/.exec(url);
    if (!m || (only && m[1] !== only)) return null;
    const f = m[3];
    if (f === '42.m3u8') return { status: 200, type: 'application/vnd.apple.mpegurl', body: HLS_MASTER };
    if (f === 'v.m3u8') return { status: 200, type: 'application/vnd.apple.mpegurl', body: HLS_MEDIA };
    if (f === 's0.ts') return { status: 200, type: 'video/mp2t', body: TS_OK };
    if (f === '42.mkv') return mkvOk ? { status: 200, type: 'video/x-matroska', body: mkv('V_MPEG4/ISO/AVC', 'A_AC3') } : { status: 404, type: 'text/html', body: 'nf' };
    if (f === '42.mp4') return mp4Ok ? { status: 200, type: 'video/mp4', body: Buffer.alloc(64) } : { status: 404, type: 'text/html', body: 'nf' };
    return { status: 404, type: 'text/html', body: 'nf' };
  };
}
function run(env, ctx, ms = 60000) {
  env.win.XIPTVLGMedia.setSource(ctx);
  env.video.src = ctx.originalUrl; env.video.load();
  for (let i = 0; i < ms / 100; i++) env.advance(100);
}
const reportText = (env) => env.overlays.map((o) => o.textContent).join('\n');

test('flow: failing HLS finds a working MKV, plays it for real, and learns the rule', () => {
  const env = makeEnv({ provider: provider(), behave: { m3u8: 'error', mkv: 'play' } });
  run(env, ctxOf());
  const text = reportText(env);
  assert.match(text, /tetik: TV hata kodu/);
  assert.match(text, /\.m3u8: HTTP 20[06]/);
  assert.match(text, /EXT-X-MEDIA/);
  assert.match(text, /ÇALIŞTI: \.mkv/);
  assert.ok(env.video.src.endsWith('/42.mkv'));
  assert.ok(env.video.attempts.length <= 4, 'bounded attempts: ' + env.video.attempts.length);
  eq(env.engine.adjust('movie', SRV, 'm3u8'), { server: SRV, ext: 'mkv' });
  assert.equal(text.includes(U) || text.includes(P) || text.includes('prov.example'), false, 'no credentials or full host in the report');
  assert.equal(env.diag.textContent.includes(U) || env.diag.textContent.includes(P), false);
  assert.equal(env.win.XIPTVPlaybackInfo.transport, 'ai-mkv');
  assert.equal(env.children.length, 1, 'one extra button, created once');
});

test('flow: nothing playable stops after at most three attempts and asks for a photo', () => {
  const env = makeEnv({ provider: provider({ mkvOk: true, mp4Ok: true }), behave: { m3u8: 'error', mkv: 'error', mp4: 'error' } });
  run(env, ctxOf(), 120000);
  const text = reportText(env);
  assert.match(text, /SONUÇ: TV tarafında otomatik çalışan yol bulunamadı/);
  assert.match(text, /fotoğrafını gönderin/);
  assert.ok(env.video.attempts.length <= 1 + 3, 'attempts: ' + env.video.attempts.length);
  assert.equal(env.engine.adjust('movie', SRV, 'm3u8'), null, 'nothing learned from failure');
  assert.equal(env.timers.filter((t) => t.every).length, 0, 'watch interval is cleaned up');
});

test('flow: HTTP-only host is found by the scheme swap', () => {
  const env = makeEnv({ provider: provider({ only: 'http', mkvOk: false }), behave: { 's:m3u8': 'error', 'p:m3u8': 'play' } });
  run(env, ctxOf());
  const text = reportText(env);
  assert.match(text, /ERİŞİLEMEDİ/);
  assert.match(text, /ÇALIŞTI: HTTP \.m3u8/);
  assert.ok(env.video.src.startsWith('http://'));
  eq(env.engine.adjust('movie', SRV, 'm3u8'), { server: 'http://prov.example:8080', ext: 'm3u8' });
});

test('flow: learned rule is dropped when the rewritten start fails again', () => {
  const env = makeEnv({ provider: provider({ mkvOk: false }), behave: { mkv: 'error', m3u8: 'error' } });
  env.engine._test.lkgRemember('movie', SRV, 'mkv', 'm3u8');
  const adj = env.engine.adjust('movie', SRV, 'm3u8');
  assert.equal(adj.ext, 'mkv');
  run(env, ctxOf('movie', 'mkv'), 20000);
  assert.equal(env.engine.adjust('movie', SRV, 'm3u8'), null);
});

test('flow: healthy playback is left alone and nothing is learned', () => {
  const env = makeEnv({ provider: provider(), behave: { m3u8: 'play' } });
  run(env, ctxOf(), 40000);
  assert.equal(reportText(env), '');
  eq(env.video.attempts, [ctxOf().originalUrl]);
  assert.equal([...env.store.values()].length, 0);
  assert.equal(env.timers.filter((t) => t.every).length, 0);
});

test('flow: live TV and series-HLS startup are never hijacked', () => {
  const live = makeEnv({ provider: provider(), behave: { m3u8: 'error' } });
  live.win.XIPTVLGMedia.setSource(null);
  live.video.src = 'https://prov.example:8080/live/a/b/1.m3u8'; live.video.load();
  for (let i = 0; i < 400; i++) live.advance(100);
  assert.equal(reportText(live), ''); assert.equal(live.video.attempts.length, 1);
  assert.equal(live.engine.adjust('live', SRV, 'm3u8'), null);
  const series = makeEnv({ provider: provider(), behave: { m3u8: 'error', mkv: 'play' } });
  series.win.XIPTVLGMedia.setSource(ctxOf('series', 'm3u8'));
  series.video.src = ctxOf('series').originalUrl; series.video.load();
  for (let i = 0; i < 400; i++) series.advance(100);
  assert.equal(reportText(series), '', 'series HLS has its own recovery; wait for its terminal flag');
  series.win.XIPTVPlaybackInfo.terminal = true;
  for (let i = 0; i < 600; i++) series.advance(100);
  assert.match(reportText(series), /tetik: oynatıcı vazgeçti/);
  assert.match(reportText(series), /ÇALIŞTI: \.mkv/);
});

test('flow: silent stall triggers after 24 seconds, a paused player does not', () => {
  const stalled = makeEnv({ provider: provider(), behave: { m3u8: 'silent', mkv: 'play' } });
  run(stalled, ctxOf(), 70000);
  assert.match(reportText(stalled), /tetik: görüntü yok/);
  const paused = makeEnv({ provider: provider(), behave: { m3u8: 'silent' } });
  paused.win.XIPTVLGMedia.setSource(ctxOf());
  paused.video.src = ctxOf().originalUrl; paused.video.load(); paused.video.paused = true;
  for (let i = 0; i < 400; i++) paused.advance(100);
  assert.equal(reportText(paused), '');
});

test('the engine takes over VOD recovery and keeps the manual button hidden for live TV', () => {
  const env = makeEnv({ provider: provider() });
  assert.equal(env.win.XIPTVVODRecovery.start({}), false);
  env.win.XIPTVLGMedia.setSource(ctxOf());
  assert.equal(env.children[0].style.display, 'inline-block');
  env.win.XIPTVLGMedia.setSource(null);
  assert.equal(env.children[0].style.display, 'none');
});
