'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// Portable path model (Release R0-B). All five roots are env-overridable;
// defaults follow the XDG layout. Existing deployments keep working because
// explicit config.json values take priority over DEFAULTS (LEGACY_COMPAT).
function pathModel() {
  const home = os.homedir();
  return {
    configDir: process.env.HUB_CONFIG_DIR || path.join(home, '.config', 'personal-operations-hub'),
    dataDir: process.env.HUB_DATA_DIR || path.join(home, '.local', 'share', 'personal-operations-hub'),
    stateDir: process.env.HUB_STATE_DIR || path.join(home, '.local', 'state', 'personal-operations-hub'),
    runtimeDir: process.env.HUB_RUNTIME_DIR || os.tmpdir(),
    workspaceRoot: process.env.HUB_WORKSPACE_ROOT || path.join(home, 'pohub-workspace'),
  };
}

const M = pathModel();

const DEFAULTS = {
  port: 8300,
  host: '127.0.0.1',
  dataDir: M.dataDir,
  dbPath: '',
  spoolDir: path.join(M.dataDir, 'gateway', 'spool'),
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
  workerDefaultWorkspace: path.join(M.workspaceRoot, 'default'),
  workerAllowedRoots: [M.workspaceRoot],
  workerTimeoutMs: 1800000,
  workerCodexModel: 'gpt-5.6-luna',
  workerProfileRoot: path.join(M.stateDir, 'workers'),
  workerDeepseekApiKeyFile: path.join(M.configDir, 'secrets', 'opencode.env'),
  codexBinary: '',
  selfDevWorkspace: path.join(M.workspaceRoot, 'hub-dev'),
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
  intelligenceApiKeyFile: path.join(M.configDir, 'secrets', 'intelligence.env'),
  intelligenceDenyEgressChats: [],
  intelligenceBudgetDailyUsd: 0.5,
  intelligenceBudgetMonthlyUsd: 5,
  analysisThresholdHigh: 0.8,
  analysisThresholdShow: 0.5,
};

function expandHome(v) {
  if (typeof v !== 'string' || !v.startsWith('~/')) return v;
  return path.join(os.homedir(), v.slice(2));
}

const PATH_KEYS = ['dataDir', 'dbPath', 'spoolDir', 'workerDefaultWorkspace', 'workerProfileRoot',
  'workerDeepseekApiKeyFile', 'selfDevWorkspace', 'intelligenceApiKeyFile'];

function load(file) {
  const cfg = Object.assign({}, DEFAULTS);
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
  if (Array.isArray(cfg.workerAllowedRoots)) {
    cfg.workerAllowedRoots = cfg.workerAllowedRoots.map(expandHome);
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
  return path.join(cfg.dataDir, 'hub.db');
}

module.exports = { load, DEFAULTS, resolveDbPath, pathModel };
