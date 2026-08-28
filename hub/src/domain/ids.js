'use strict';
const crypto = require('crypto');

function id(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

function dispatchId() {
  return `dsp-${crypto.randomUUID()}`;
}

module.exports = { id, dispatchId };
