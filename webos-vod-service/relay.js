'use strict';
// The runtime on 2015 TVs is Node 0.10. Bind only to loopback and expose
// opaque session paths. Only the service subscription supplies the source URL.
var http = require('http');
var https = require('https');
var url = require('url');
var crypto = require('crypto');
var dns = require('dns');

function publicIPv4(address) {
  var a = address.split('.').map(Number);
  return a.length === 4 && a[0] > 0 && a[0] < 224 && a[0] !== 10 && a[0] !== 127 &&
    !(a[0] === 169 && a[1] === 254) && !(a[0] === 172 && a[1] >= 16 && a[1] <= 31) &&
    !(a[0] === 192 && a[1] === 168) && !(a[0] === 100 && a[1] >= 64 && a[1] <= 127) &&
    !(a[0] === 198 && (a[1] === 18 || a[1] === 19));
}

module.exports = function createRelay(source, report) {
  var origin = url.parse(source);
  var prefix = '/' + crypto.randomBytes(20).toString('hex') + '/';
  var entries = Object.create(null), paths = Object.create(null), count = 0;
  var seen = Object.create(null), sockets = [], closed = false;
  function signal(stage) {
    if (!closed && !seen[stage]) {
      seen[stage] = true;
      report({returnValue: true, subscribed: true, stage: stage});
    }
  }
  function entry(target, kind, ext) {
    if (!/^https?:\/\/[^/\s]+/i.test(target)) throw Error('Unexpected URI');
    var key = kind + ':' + target;
    if (paths[key]) return paths[key];
    if (count >= 20000) throw Error('Playlist too large');
    var path = prefix + (++count) + '.' + ext;
    paths[key] = path;
    entries[path] = {target: target, kind: kind};
    return path;
  }
  function rewrite(text, base) {
    text = text.replace(/^\uFEFF/, '');
    if (!/^#EXTM3U(?:\s|$)/.test(text)) throw Error('Not HLS');
    var variant = false;
    return text.split(/\r?\n/).map(function (line) {
      if (/^#EXT-X-STREAM-INF:/.test(line)) variant = true;
      if (!line.trim()) return line;
      if (line.charAt(0) === '#') {
        var playlist = /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF):/.test(line);
        var init = /^#EXT-X-MAP:/.test(line);
        return line.replace(/\bURI="([^"]+)"/g, function (_, uri) {
          var path = entry(url.resolve(base, uri), playlist ? 'list' : init ? 'mp4' : 'data', playlist ? 'm3u8' : init ? 'mp4' : 'bin');
          return 'URI="' + path + '"';
        });
      }
      var target = url.resolve(base, line.trim());
      var kind = variant ? 'list' : /\.(?:mp4|m4s)(?:[?#]|$)/i.test(target) ? 'mp4' : /\.aac(?:[?#]|$)/i.test(target) ? 'aac' : /\.vtt(?:[?#]|$)/i.test(target) ? 'vtt' : 'ts';
      variant = false;
      return entry(target, kind, kind === 'list' ? 'm3u8' : kind);
    }).join('\n');
  }
  var types = {list: 'application/vnd.apple.mpegurl', ts: 'video/mp2t', mp4: 'video/mp4', aac: 'audio/aac', vtt: 'text/vtt', data: 'application/octet-stream'};
  entries[prefix + 'index.m3u8'] = {target: source, kind: 'list'};
  var server = http.createServer(function (req, res) {
    var item = entries[req.url], upstream, abandoned = false;
    if (!item || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404); res.end(); return;
    }
    res.on('close', function () { abandoned = true; if (upstream) upstream.abort(); });
    function fail(status) {
      if (abandoned || res.finished) return;
      signal('error-' + item.kind + '-' + status);
      if (res.headersSent) { if (res.socket) res.socket.destroy(); return; }
      res.writeHead(status); res.end();
    }
    var list = item.kind === 'list';
    if (req.method === 'GET') signal(list ? 'list-request' : 'media-request');
    function fetch(target, redirects) {
      try {
        var options = url.parse(target);
        options.redirectCount = redirects;
        if (options.protocol !== 'http:' && options.protocol !== 'https:') { fail(502); return; }
        options.headers = {'Accept-Encoding': 'identity'};
        if (!list && req.headers.range) options.headers.Range = req.headers.range;
        options.method = list ? 'GET' : req.method;
        if (options.protocol === origin.protocol && options.host === origin.host) { request(options); return; }
        // CDN addresses may differ from the account host. Pin the verified
        // public address so a playlist cannot redirect the player into the LAN.
        dns.lookup(options.hostname, 4, function (error, address) {
          if (abandoned || closed) return;
          if (error || !publicIPv4(address)) { fail(502); return; }
          options.headers.Host = options.host;
          options.servername = options.hostname;
          options.hostname = address;
          options.agent = false;
          request(options);
        });
      } catch (e) { fail(502); }
    }
    function request(options) {
      try {
        var target = options.href;
        upstream = (options.protocol === 'https:' ? https : http).request(options, function (reply) {
          reply.on('error', function () { fail(502); });
          reply.on('aborted', function () { fail(502); });
          var status = reply.statusCode;
          if (status >= 300 && status < 400 && reply.headers.location) {
            reply.resume();
            if (options.redirectCount >= 5) { fail(502); return; }
            fetch(url.resolve(target, reply.headers.location), options.redirectCount + 1);
            return;
          }
          if (status < 200 || status >= 300) { reply.resume(); fail(status >= 400 ? status : 502); return; }
          var headers = {'Content-Type': types[item.kind], 'Cache-Control': 'no-store'};
          if (!list) {
            ['content-range','content-length','accept-ranges'].forEach(function (name) {
              if (reply.headers[name]) headers[name] = reply.headers[name];
            });
            res.writeHead(status, headers);
            if (req.method === 'GET') reply.once('data', function () { signal('media-bytes'); });
            reply.pipe(res);
            return;
          }
          var chunks = [], size = 0;
          reply.on('data', function (chunk) {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) { fail(502); reply.destroy(); return; }
            chunks.push(chunk);
          });
          reply.on('end', function () {
            if (abandoned || res.finished) return;
            try {
              var body = rewrite(Buffer.concat(chunks).toString('utf8'), target);
              headers['Content-Length'] = Buffer.byteLength(body);
              res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : body);
              if (req.method === 'GET') signal('list-ready');
            } catch (e) { fail(502); }
          });
        });
        upstream.on('error', function () { fail(502); });
        upstream.setTimeout(12000, function () { fail(504); this.abort(); });
        upstream.end();
      } catch (e) { fail(502); }
    }
    fetch(item.target, 0);
  });
  server.on('connection', function (socket) {
    sockets.push(socket);
    socket.on('close', function () { var i = sockets.indexOf(socket); if (i >= 0) sockets.splice(i, 1); });
  });
  server.on('error', function () { if (!closed) report({returnValue: false, errorText: 'Local listener unavailable'}); });
  server.listen(0, '127.0.0.1', function () {
    if (closed) { server.close(); return; }
    report({returnValue: true, subscribed: true, url: 'http://127.0.0.1:' + server.address().port + prefix + 'index.m3u8'});
  });
  return {close: function () {
    if (closed) return;
    closed = true;
    if (server.address()) server.close();
    sockets.slice().forEach(function (socket) { socket.destroy(); });
  }};
};
