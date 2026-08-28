'use strict';
// config.js — load config with defaults
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  gateway_id: 'huago-cone-wechat-01',
  base_url: 'http://127.0.0.1:6174',
  token_file: path.join(__dirname, '..', '..', 'deploy', 'token'),
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

function load(file) {
  const cfg = { ...DEFAULTS };
  if (file && fs.existsSync(file)) {
    try {
      Object.assign(cfg, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      throw new Error(`config invalid: ${e.message}`);
    }
  }
  return cfg;
}

module.exports = { load, DEFAULTS };
