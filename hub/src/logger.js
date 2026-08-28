'use strict';
const crypto = require('crypto');

const RANKS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

class Logger {
  constructor({ level = 'INFO', stream = process.stdout } = {}) {
    this.level = level.toUpperCase();
    this.rank = RANKS[this.level] || RANKS.INFO;
    this.stream = stream;
  }

  hashId(v) {
    if (v === null || v === undefined) return null;
    return crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 8);
  }

  write(level, msg, extra) {
    if (RANKS[level] < this.rank) return;
    const rec = { at: new Date().toISOString(), level, msg };
    if (extra) Object.assign(rec, extra);
    this.stream.write(JSON.stringify(rec) + '\n');
  }

  debug(msg, extra) { this.write('DEBUG', msg, extra); }
  info(msg, extra) { this.write('INFO', msg, extra); }
  warn(msg, extra) { this.write('WARN', msg, extra); }
  error(msg, extra) { this.write('ERROR', msg, extra); }
}

module.exports = { Logger };
