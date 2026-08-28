'use strict';
// spool.js — durable JSONL spool, one file per UTC day, fsync per message
const fs = require('fs');
const path = require('path');

class Spool {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(this.dir, { recursive: true });
    this._fd = null;
    this._day = null;
  }

  _dayKey(d = new Date()) {
    return d.toISOString().slice(0, 10); // UTC day
  }

  _ensureFile(day) {
    if (this._fd && this._day === day) return;
    if (this._fd) { try { fs.closeSync(this._fd); } catch (e) { /* ignore */ } }
    this._day = day;
    const file = path.join(this.dir, `${day}.jsonl`);
    this._fd = fs.openSync(file, 'a');
  }

  append(record) {
    const day = this._dayKey();
    this._ensureFile(day);
    const line = JSON.stringify(record) + '\n';
    fs.writeSync(this._fd, line);
    fs.fsyncSync(this._fd);
    return day;
  }

  // total size of spool dir (bytes)
  totalBytes() {
    let n = 0;
    for (const f of fs.readdirSync(this.dir)) {
      try { n += fs.statSync(path.join(this.dir, f)).size; } catch (e) { /* ignore */ }
    }
    return n;
  }

  // oldest & newest files for daily-size reporting
  fileList() {
    return fs.readdirSync(this.dir).filter((f) => f.endsWith('.jsonl')).sort();
  }

  close() {
    if (this._fd) { try { fs.closeSync(this._fd); } catch (e) { /* ignore */ } this._fd = null; }
  }
}

module.exports = { Spool };
