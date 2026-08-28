'use strict';
// agent-client.js — READ-ONLY client for agent-wechat.
// Only GET requests are implemented. There is intentionally NO generic
// request(method, path) helper; adding any write capability requires
// explicit code that the read-only static check (scripts/check-readonly.sh)
// will flag.
const fs = require('fs');

const ALLOWED_PATHS = {
  auth: '/api/status/auth',
  chats: '/api/chats',
};

class AgentError extends Error {
  constructor(kind, message, extra) {
    super(message);
    this.kind = kind; // NETWORK_ERROR | AUTH_ERROR | WECHAT_LOGGED_OUT | AGENT_ERROR | INVALID_RESPONSE | TIMEOUT
    this.extra = extra || {};
  }
}

class AgentClient {
  constructor(opts) {
    this.baseUrl = opts.baseUrl || 'http://127.0.0.1:6174';
    this.token = fs.readFileSync(opts.tokenFile, 'utf8').trim();
    this.timeoutMs = opts.timeoutMs || 30000;
  }

  async _get(pathAndQuery) {
    const url = `${this.baseUrl}${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.token)}`;
    let res;
    try {
      res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        throw new AgentError('TIMEOUT', `timeout after ${this.timeoutMs}ms`, { url });
      }
      throw new AgentError('NETWORK_ERROR', e.message, { url });
    }
    if (res.status === 401 || res.status === 403) {
      throw new AgentError('AUTH_ERROR', `HTTP ${res.status}`, { url });
    }
    if (res.status >= 500) {
      throw new AgentError('AGENT_ERROR', `HTTP ${res.status}`, { url });
    }
    if (!res.ok) {
      throw new AgentError('AGENT_ERROR', `HTTP ${res.status}`, { url });
    }
    try {
      return await res.json();
    } catch (e) {
      throw new AgentError('INVALID_RESPONSE', `bad json: ${e.message}`, { url });
    }
  }

  // ---- the only 4 read-only methods ----

  async getAuthStatus() {
    const j = await this._get(ALLOWED_PATHS.auth);
    if (j && typeof j.status === 'string') return j;
    throw new AgentError('INVALID_RESPONSE', 'auth response missing status');
  }

  async listChats(limit = 50) {
    const j = await this._get(`${ALLOWED_PATHS.chats}?limit=${limit}&offset=0`);
    if (Array.isArray(j)) return j;
    throw new AgentError('INVALID_RESPONSE', 'chats response is not an array');
  }

  async listMessages(chatId, limit = 30) {
    const j = await this._get(`/api/messages/${encodeURIComponent(chatId)}?limit=${limit}&offset=0`);
    if (Array.isArray(j)) return j;
    throw new AgentError('INVALID_RESPONSE', 'messages response is not an array');
  }

  async getMedia(chatId, localId) {
    return this._get(`/api/messages/${encodeURIComponent(chatId)}/media/${localId}`);
  }
}

module.exports = { AgentClient, AgentError };
