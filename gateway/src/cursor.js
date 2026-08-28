'use strict';
// cursor.js — durable cursor with atomic write (tmp + fsync + rename)
const fs = require('fs');
const path = require('path');

class CursorStore {
  constructor(file) {
    this.file = file;
    this.data = { chats: {}, sequence: 0, updated_at: null };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        const raw = fs.readFileSync(this.file, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.chats) {
          this.data = parsed;
        } else {
          throw new Error('invalid cursor shape');
        }
      } catch (e) {
        throw new Error(`cursor corruption: ${e.message}; refusing to start (fix or remove ${this.file})`);
      }
    }
  }

  getChat(chatId) {
    return this.data.chats[chatId] || null;
  }

  setChat(chatId, lastLocalId) {
    this.data.chats[chatId] = {
      last_local_id: lastLocalId,
      updated_at: new Date().toISOString(),
    };
  }

  nextSequence() {
    this.data.sequence += 1;
    return this.data.sequence;
  }

  // atomic persist: tmp -> fsync -> rename -> fsync dir
  persist() {
    this.data.updated_at = new Date().toISOString();
    const tmp = `${this.file}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(this.data, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
    const dirFd = fs.openSync(path.dirname(this.file), 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  }
}

module.exports = { CursorStore };
