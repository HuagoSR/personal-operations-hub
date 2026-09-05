'use strict';
// config.js — load config with defaults (portable, release R0-B)
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = {
  gateway_id: 'wechat-gateway-01',
  base_url: 'http://127.0.0.1:6174',
  token_file: path.join(__dirname, '..', '..', 'deploy', 'token'),
  wechat_container_name: 'wx-research-agent-wechat',
  poll_ms: 2000,
  fetch_limit: 30,
  chats_limit: 50,
  auth_check_interval_ms: 10000,
  health_write_interval_ms: 10000,
  resource_sample_interval_ms: 60000,
  metrics_write_interval_ms: 60000,
  dedup_size: 10000,
  request_timeout_ms: 30000,
  backoff: [1000, 2000, 4000, 8000, 15000, 30000],
  log_level: 'INFO',
  data_dir: path.join(__dirname, '..', 'data'),
  log_dir: path.join(__dirname, '..', 'logs'),
  skip_chats: ['filehelper', 'weixin', 'qmessage', 'floatbottle', 'medianote', 'notifymessage', 'fmessage'],
  chat_filter: '',
};

const PATH_KEYS = ['token_file', 'data_dir', 'log_dir'];

function expandHome(v) {
  if (typeof v !== 'string' || !v.startsWith('~/')) return v;
  return path.join(os.homedir(), v.slice(2));
}

function load(file) {
  const cfg = { ...DEFAULTS };
  if (file && fs.existsSync(file)) {
    try {
      Object.assign(cfg, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      throw new Error(`config invalid: ${e.message}`);
    }
  }
  for (const k of PATH_KEYS) {
    if (typeof cfg[k] === 'string') cfg[k] = expandHome(cfg[k]);
  }
  if (process.env.GATEWAY_ID) cfg.gateway_id = process.env.GATEWAY_ID;
  if (process.env.GATEWAY_TOKEN_FILE) cfg.token_file = process.env.GATEWAY_TOKEN_FILE;
  if (process.env.GATEWAY_DATA_DIR) cfg.data_dir = process.env.GATEWAY_DATA_DIR;
  if (process.env.WECHAT_CONTAINER_NAME) cfg.wechat_container_name = process.env.WECHAT_CONTAINER_NAME;
  return cfg;
}

module.exports = { load, DEFAULTS };
