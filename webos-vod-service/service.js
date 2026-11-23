'use strict';
var Service = require('webos-service');
var createRelay = require('./relay');
var service = new Service('com.xiptvplay.tv.native.vod');
var active = null;

var open = service.register('open', function (message) {
  if (message.sender !== 'com.xiptvplay.tv.native') {
    message.respond({returnValue: false, errorText: 'Unknown player'});
    return;
  }
  var source = message.payload.url;
  if (!message.isSubscription || typeof source !== 'string' || !/^https?:\/\//i.test(source)) {
    message.respond({returnValue: false, errorText: 'Invalid playback session'});
    return;
  }
  if (active) active.relay.close();
  var session = {token: message.uniqueToken};
  active = session;
  session.relay = createRelay(source, function (event) {
    if (active === session) message.respond(event);
  });
});
open.on('cancel', function (message) {
  if (active && active.token === message.uniqueToken) {
    active.relay.close();
    active = null;
  }
});
