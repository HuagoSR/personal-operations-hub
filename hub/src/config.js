'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  port: 8300,
  host: '127.0.0.1',
  dataDir: 'data',
  dbPath: '',
  spoolDir: '/home/huagosr/wechat-linux-research/gateway/data/spool',
  ingestEnabled: true,
  ingestIntervalMs: 5000,
  inboxRule: 'mentioned_or_direct',
  dispatcherIntervalMs: 1000,
  pumpIntervalMs: 500,
  sweepIntervalMs: 1000,
  approvalDefaultTtlMs: 86400000,
  workerStepDelayMs: 100,
  workerCrashRetryMs: 2000,
  workerCrashMaxAttempts: 3,
  executionTimeoutMs: 60000,
  outboxMaxAttempts: 5,
  outboxBackoffMs: [1000, 2000, 4000, 8000, 15000],
  logLevel: 'INFO',
  workerDefaultWorkspace: '/home/huagosr/worker-sandbox-untrusted/calc',
  workerAllowedRoots: ['/home/huagosr/worker-sandbox-untrusted', '/home/huagosr/worker-sandbox'],
  workerTimeoutMs: 1800000,
  workerCodexModel: 'gpt-5.6-luna',
  workerProfileRoot: '',
  workerDeepseekApiKeyFile: '/home/huagosr/.opencode/.env',
  selfDevWorkspace: '/home/huagosr/worker-sandbox-untrusted/hub-dev',
  selfDevBaseTag: 'phase6d-known-good',
  intelligenceEnabled: false,
  episodeIdleMs: 600000,
  episodeMaxMessages: 30,
  intelligenceSweepIntervalMs: 60000,
  intelligenceProcessIntervalMs: 30000,
  intelligenceProvider: 'deepseek',
  intelligenceModel: 'deepseek-chat',
  intelligenceApiBase: 'https://api.deepseek.com',
  intelligenceApiKeyEnv: 'HUB_INTELLIGENCE_API_KEY',
  intelligenceApiKeyFile: '/home/huagosr/.hub-intelligence.env',
  intelligenceDenyEgressChats: [],
  intelligenceBudgetDailyUsd: 0.5,
  intelligenceBudgetMonthlyUsd: 5,
  analysisThresholdHigh: 0.8,
  analysisThresholdShow: 0.5,
};

function load(file) {
  const cfg = Object.assign({}, DEFAULTS);
  if (file && fs.existsSync(file)) {
    try {
      Object.assign(cfg, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      throw new Error(`config invalid: ${e.message}`);
    }
  }
  if (cfg.workerDeepseekApiKeyFile && fs.existsSync(cfg.workerDeepseekApiKeyFile)) {
    const raw = fs.readFileSync(cfg.workerDeepseekApiKeyFile, 'utf8').split('\n')[0];
    const idx = raw.indexOf('=');
    if (idx > 0) cfg.workerDeepseekApiKey = raw.slice(idx + 1).trim();
  }
  if (cfg.intelligenceApiKeyFile && fs.existsSync(cfg.intelligenceApiKeyFile)) {
    const raw = fs.readFileSync(cfg.intelligenceApiKeyFile, 'utf8').split('\n')[0];
    const idx = raw.indexOf('=');
    if (idx > 0) cfg.intelligenceApiKey = raw.slice(idx + 1).trim();
  }
  if (process.env.HUB_INTELLIGENCE_API_KEY) cfg.intelligenceApiKey = process.env.HUB_INTELLIGENCE_API_KEY;
  if (process.env.HUB_WORKER_DEEPSEEK_API_KEY) cfg.workerDeepseekApiKey = process.env.HUB_WORKER_DEEPSEEK_API_KEY;
  if (process.env.HUB_PORT) cfg.port = parseInt(process.env.HUB_PORT, 10);
  if (process.env.HUB_HOST) cfg.host = process.env.HUB_HOST;
  if (process.env.HUB_DB_PATH) cfg.dbPath = process.env.HUB_DB_PATH;
  if (process.env.HUB_SPOOL_DIR) cfg.spoolDir = process.env.HUB_SPOOL_DIR;
  if (process.env.HUB_DATA_DIR) cfg.dataDir = process.env.HUB_DATA_DIR;
  if (process.env.HUB_INGEST_DISABLED === '1') cfg.ingestEnabled = false;
  return cfg;
}

function resolveDbPath(cfg, root) {
  if (cfg.dbPath) {
    return path.isAbsolute(cfg.dbPath) ? cfg.dbPath : path.join(root, cfg.dbPath);
  }
  return path.join(root, cfg.dataDir, 'hub.db');
}

module.exports = { load, DEFAULTS, resolveDbPath };
