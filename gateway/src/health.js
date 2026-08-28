'use strict';
// health.js — gateway health model, atomic write every 10s
const fs = require('fs');
const path = require('path');

class Health {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.v = {
      gateway: 'starting',
      agent_wechat: 'unknown',
      wechat_auth: 'unknown',
      collector: 'running',
      last_poll_at: null,
      last_successful_poll_at: null,
      last_message_at: null,
      last_spool_write_at: null,
      poll_failures_consecutive: 0,
      messages_collected_total: 0,
      duplicate_messages_total: 0,
      errors_total: 0,
      uptime_seconds: 0,
    };
    this.startedAt = Date.now();
  }

  update(patch) { Object.assign(this.v, patch); }

  write() {
    this.v.uptime_seconds = Math.floor((Date.now() - this.startedAt) / 1000);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.v, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Health };
