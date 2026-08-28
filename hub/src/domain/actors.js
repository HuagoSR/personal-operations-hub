'use strict';

const ACTORS = {
  USER: 'USER',
  HUB: 'HUB',
  SYSTEM: 'SYSTEM',
  WECHAT_SOURCE: 'WECHAT_SOURCE',
  CONTROL_CHANNEL: 'CONTROL_CHANNEL',
  FAKE_WORKER: 'FAKE_WORKER',
};

const IDS = {
  [ACTORS.USER]: 'owner',
  [ACTORS.HUB]: 'hub-v01',
  [ACTORS.SYSTEM]: 'system',
  [ACTORS.WECHAT_SOURCE]: 'wechat-gateway',
  [ACTORS.CONTROL_CHANNEL]: 'control-web',
  [ACTORS.FAKE_WORKER]: 'fake-worker',
};

function actor(type, id) {
  return { actorType: type, actorId: id || IDS[type] || type.toLowerCase() };
}

module.exports = { ACTORS, IDS, actor };
