'use strict';
// dedup.js — second-layer dedup beyond cursor (recent N keys, persisted)
const fs = require('fs');
const path = require('path');

class DedupSet {
  constructor(file, maxSize = 10000) {
    this.file = file;
    this.maxSize = maxSize;
    this.keys = new Set();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        const arr = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        for (const k of arr.slice(-this.maxSize)) this.keys.add(k);
      } catch (e) { /* corrupted dedup backup: start empty */ }
    }
  }

  static keyOf(chatId, localId) {
    return `wechat:${chatId}:${localId}`;
  }

  // returns true if newly added; false if already present
  add(chatId, localId) {
    const k = DedupSet.keyOf(chatId, localId);
    if (this.keys.has(k)) return false;
    this.keys.add(k);
    while (this.keys.size > this.maxSize) {
      const first = this.keys.values().next().value;
      this.keys.delete(first);
    }
    return true;
  }

  has(chatId, localId) {
    return this.keys.has(DedupSet.keyOf(chatId, localId));
  }

  persist() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...this.keys]));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { DedupSet };
