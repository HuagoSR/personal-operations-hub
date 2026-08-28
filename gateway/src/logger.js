'use strict';
// logger.js — leveled logging with privacy hashing + rotation
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

class Logger {
  constructor(opts) {
    this.dir = opts.dir;
    this.level = LEVELS[opts.level] ?? LEVELS.INFO;
    this.maxBytes = opts.maxBytes || 5 * 1024 * 1024;
    this.maxFiles = opts.maxFiles || 5;
    this.file = path.join(this.dir, 'gateway.log');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  hashId(id) {
    if (!id) return 'null';
    return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 8);
  }

  _write(level, msg) {
    if (LEVELS[level] < this.level) return;
    const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
    try {
      this._rotateIfNeeded();
      fs.appendFileSync(this.file, line);
    } catch (e) {
      // never let logging crash the gateway
      process.stderr.write(`log write failed: ${e.message}\n`);
    }
  }

  _rotateIfNeeded() {
    let size = 0;
    try { size = fs.statSync(this.file).size; } catch (e) { return; }
    if (size < this.maxBytes) return;
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const src = `${this.file}.${i}`;
      const dst = `${this.file}.${i + 1}`;
      try { if (fs.existsSync(src)) fs.renameSync(src, dst); } catch (e) { /* ignore */ }
    }
    try { fs.renameSync(this.file, `${this.file}.1`); } catch (e) { /* ignore */ }
    for (let i = this.maxFiles + 1; i <= 99; i++) {
      try { if (fs.existsSync(`${this.file}.${i}`)) fs.unlinkSync(`${this.file}.${i}`); } catch (e) { break; }
    }
  }

  debug(...a) { this._write('DEBUG', a.join(' ')); }
  info(...a) { this._write('INFO', a.join(' ')); }
  warn(...a) { this._write('WARN', a.join(' ')); }
  error(...a) { this._write('ERROR', a.join(' ')); }
}

module.exports = { Logger };
