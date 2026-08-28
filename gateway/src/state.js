'use strict';
// state.js — explicit gateway state machine
const VALID = ['STARTING', 'RUNNING', 'DEGRADED', 'WAITING_FOR_LOGIN', 'ERROR', 'STOPPING'];

class GatewayState {
  constructor(logger) {
    this.logger = logger;
    this.current = 'STARTING';
  }

  set(next) {
    if (!VALID.includes(next)) {
      this.logger.error(`invalid state transition to ${next}`);
      return;
    }
    if (next !== this.current) {
      this.logger.info(`state ${this.current} -> ${next}`);
      this.current = next;
    }
  }

  get() { return this.current; }
}

module.exports = { GatewayState };
