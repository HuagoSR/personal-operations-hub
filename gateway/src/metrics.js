'use strict';
// metrics.js — daily metrics file with counters + resource samples
const fs = require('fs');
const path = require('path');

class Metrics {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(this.dir, { recursive: true });
    this.today = new Date().toISOString().slice(0, 10);
    this.data = this._load(this.today);
  }

  _file(day) { return path.join(this.dir, `${day}.json`); }

  _load(day) {
    const f = this._file(day);
    if (fs.existsSync(f)) {
      try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { /* fallthrough */ }
    }
    return {
      day,
      poll_count: 0,
      poll_failures: 0,
      messages_collected: 0,
      duplicate_messages: 0,
      auth_loss_count: 0,
      agent_error_count: 0,
      gateway_restart_count: 0,
      wechat_restart_count: 0,
      visibility_delay: { samples: 0, p50: null, p95: null, max: null, note: 'collected_at - wechat_timestamp (sender clock, unreliable)' },
      delays: [],
      spool_daily_bytes: {},
      samples: [],
    };
  }

  _rollover() {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.today) {
      this.write();
      this.today = day;
      this.data = this._load(day);
    }
  }

  inc(key, n = 1) { this._rollover(); this.data[key] = (this.data[key] || 0) + n; }

  recordDelay(sec) {
    this._rollover();
    const d = this.data;
    d.delays.push(sec);
    if (d.delays.length > 1000) d.delays = d.delays.slice(-1000);
    const sorted = [...d.delays].sort((a, b) => a - b);
    d.visibility_delay.samples = sorted.length;
    d.visibility_delay.p50 = sorted[Math.floor(sorted.length * 0.5)];
    d.visibility_delay.p95 = sorted[Math.floor(sorted.length * 0.95)];
    d.visibility_delay.max = sorted[sorted.length - 1];
  }

  recordSpoolSize(bytes) {
    this._rollover();
    this.data.spool_daily_bytes = this.data.spool_daily_bytes || {};
    const day = new Date().toISOString().slice(0, 10);
    this.data.spool_daily_bytes[day] = bytes;
  }

  addSample(s) {
    this._rollover();
    this.data.samples.push({ at: new Date().toISOString(), ...s });
    if (this.data.samples.length > 60 * 24 * 8) this.data.samples = this.data.samples.slice(-60 * 24 * 8);
  }

  write() {
    const tmp = this._file(this.today) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this._file(this.today));
  }
}

module.exports = { Metrics };
