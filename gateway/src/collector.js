'use strict';
// collector.js — Gateway V0.1 main loop
// READ-ONLY: this process only issues GET requests via agent-client.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Logger } = require('./logger');
const { AgentClient, AgentError } = require('./agent-client');
const { CursorStore } = require('./cursor');
const { Spool } = require('./spool');
const { DedupSet } = require('./dedup');
const { Health } = require('./health');
const { Metrics } = require('./metrics');
const { GatewayState } = require('./state');
const { load } = require('./config');

const ROOT = path.join(__dirname, '..');
const cfg = load(path.join(ROOT, 'config', 'config.json'));
const logger = new Logger({ dir: cfg.log_dir, level: cfg.log_level });

// ---------- PID single-instance lock ----------
const PID_FILE = path.join(cfg.data_dir, 'state', 'gateway.pid');
fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
if (fs.existsSync(PID_FILE)) {
  const prev = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
  if (!isNaN(prev) && prev > 0) {
    try {
      process.kill(prev, 0);
      console.error(`Gateway already running (pid ${prev}). Refusing to start.`);
      process.exit(1);
    } catch (e) {
      // stale lock: remove
      fs.unlinkSync(PID_FILE);
    }
  } else {
    fs.unlinkSync(PID_FILE);
  }
}
fs.writeFileSync(PID_FILE, String(process.pid) + '\n');

// ---------- core objects ----------
const client = new AgentClient({ baseUrl: cfg.base_url, tokenFile: cfg.token_file, timeoutMs: cfg.request_timeout_ms });
const cursor = new CursorStore(path.join(cfg.data_dir, 'state', 'cursor.json'));
const spool = new Spool(path.join(cfg.data_dir, 'spool'));
const dedup = new DedupSet(path.join(cfg.data_dir, 'state', 'dedup.json'), cfg.dedup_size);
const health = new Health(path.join(cfg.data_dir, 'state', 'health.json'));
const metrics = new Metrics(path.join(cfg.data_dir, 'metrics'));
const state = new GatewayState(logger);

const skipChats = new Set(cfg.skip_chats);
let stopping = false;
let authStatus = 'unknown';
let loggedInUser = null;
let authLosses = 0;
let backoffIdx = 0;
let pollFailuresConsecutive = 0;
let lastPollAt = null;
let lastSuccessfulPollAt = null;

// ---------- resource sampling ----------
function sampleResources() {
  try {
    const out = execSync('docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}"', { encoding: 'utf8', timeout: 15000 });
    let wxCpu = null, wxMem = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('wx-research-agent-wechat')) {
        const [, cpu, mem] = line.split('|');
        wxCpu = parseFloat(cpu.replace('%', ''));
        const m = mem.match(/([\d.]+)MiB/);
        wxMem = m ? parseFloat(m[1]) : null;
      }
    }
    const loadavg = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(' ').slice(0, 3).map(Number);
    const meminfo = {};
    for (const line of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+)\s*kB/);
      if (m) meminfo[m[1]] = parseInt(m[2], 10);
    }
    const df = execSync('df -k ' + cfg.data_dir, { encoding: 'utf8', timeout: 10000 }).trim().split('\n')[1].split(/\s+/);
    metrics.addSample({
      wechat_cpu_pct: wxCpu,
      wechat_mem_mib: wxMem,
      host_load1: loadavg[0],
      host_mem_avail_mib: Math.round((meminfo.MemAvailable || 0) / 1024),
      disk_free_kb: parseInt(df[3], 10),
      spool_bytes: spool.totalBytes(),
      gateway_mem_mib: Math.round(process.memoryUsage().rss / 1024 / 1024),
    });
  } catch (e) {
    logger.debug(`resource sample failed: ${e.message}`);
  }
}

// ---------- message pipeline ----------
function buildRecord(msg, chat) {
  const chatId = chat.username || chat.id;
  return {
    schema_version: 1,
    source: 'wechat',
    gateway_id: cfg.gateway_id,
    chat_type: chat.isGroup ? 'group' : 'direct',
    chat_id: chatId,
    chat_name: chat.name || chatId,
    sender_id: msg.sender || null,
    sender_name: msg.senderName || null,
    message_id: String(msg.localId),
    local_id: msg.localId,
    message_type: String(msg.type),
    text: msg.content || '',
    is_mentioned: msg.isMentioned === true,
    reply: msg.reply || null,
    wechat_timestamp: msg.timestamp,
    collected_at: new Date().toISOString(),
    sequence: cursor.nextSequence(),
  };
}

async function processChat(chat) {
  const chatId = chat.username || chat.id;
  if (!chatId || skipChats.has(chatId)) return;
  if (cfg.chat_filter && chatId !== cfg.chat_filter) return;

  const isGroup = !!chat.isGroup;
  const existing = cursor.getChat(chatId);
  const msgs = await client.listMessages(chatId, cfg.fetch_limit);
  if (!existing) {
    // baseline: unread-aware (phase 6 validated behavior — do NOT regress)
    if (msgs.length === 0) return;
    const sorted = [...msgs].sort((a, b) => a.localId - b.localId);
    const unread = chat.unreadCount || 0;
    let fresh;
    if (unread > 0 && unread < sorted.length) fresh = sorted.slice(-unread);
    else if (unread >= sorted.length) fresh = sorted;
    else fresh = [];
    for (const m of fresh) {
      if (!dedup.add(chatId, m.localId)) { metrics.inc('duplicate_messages'); continue; }
      const rec = buildRecord(m, { ...chat, isGroup });
      spool.append(rec);
      metrics.inc('messages_collected');
      health.update({ messages_collected_total: metrics.data.messages_collected });
      health.update({ last_message_at: rec.collected_at, last_spool_write_at: rec.collected_at });
      if (rec.wechat_timestamp) metrics.recordDelay((new Date(rec.collected_at) - new Date(rec.wechat_timestamp)) / 1000);
      logger.info(`baseline emit chat=${logger.hashId(chatId)} new_messages=${fresh.length} type=${m.type}`);
    }
    const last = sorted[sorted.length - 1];
    cursor.setChat(chatId, last.localId);
    cursor.persist();
    dedup.persist();
    return;
  }

  const fresh = msgs.filter((m) => m.localId > existing.last_local_id).sort((a, b) => a.localId - b.localId);
  if (fresh.length === 0) return;
  for (const m of fresh) {
    if (!dedup.add(chatId, m.localId)) { metrics.inc('duplicate_messages'); health.update({ duplicate_messages_total: metrics.data.duplicate_messages }); continue; }
    const rec = buildRecord(m, { ...chat, isGroup });
    spool.append(rec);
    metrics.inc('messages_collected');
    health.update({ messages_collected_total: metrics.data.messages_collected });
    health.update({ last_message_at: rec.collected_at, last_spool_write_at: rec.collected_at });
    if (rec.wechat_timestamp) metrics.recordDelay((new Date(rec.collected_at) - new Date(rec.wechat_timestamp)) / 1000);
  }
  cursor.setChat(chatId, fresh[fresh.length - 1].localId);
  cursor.persist();
  dedup.persist();
  logger.info(`poll emit chat=${logger.hashId(chatId)} new_messages=${fresh.length}`);
}

async function pollOnce() {
  const chats = await client.listChats(cfg.chats_limit);
  for (const chat of chats) await processChat(chat);
}

// ---------- auth monitor ----------
async function authCheck() {
  try {
    const a = await client.getAuthStatus();
    const next = a.status;
    if (next !== authStatus) {
      logger.warn(`auth state changed ${authStatus} -> ${next}`);
      if (authStatus === 'logged_in' && next !== 'logged_in') {
        authLosses++;
        metrics.inc('auth_loss_count');
      }
      if (next === 'logged_in' && authStatus !== 'logged_in') {
        logger.info(`recovered to logged_in user=${logger.hashId(a.loggedInUser)}`);
      }
      authStatus = next;
      loggedInUser = a.loggedInUser || null;
    }
    health.update({ wechat_auth: next });
    if (next === 'logged_in') {
      if (state.get() === 'WAITING_FOR_LOGIN') state.set('RUNNING');
    } else if (next === 'app_not_running') {
      state.set('DEGRADED');
    } else {
      state.set('WAITING_FOR_LOGIN');
    }
  } catch (e) {
    health.update({ wechat_auth: 'unknown' });
    logger.debug(`auth check failed: ${e.message}`);
  }
}

// ---------- loops ----------
let nextPollAt = Date.now();
async function pollLoop() {
  while (!stopping) {
    const now = Date.now();
    if (now >= nextPollAt) {
      lastPollAt = new Date().toISOString();
      try {
        await pollOnce();
        backoffIdx = 0;
        pollFailuresConsecutive = 0;
        lastSuccessfulPollAt = new Date().toISOString();
        metrics.inc('poll_count');
        health.update({ poll_failures_consecutive: 0, last_successful_poll_at: lastSuccessfulPollAt, agent_wechat: 'reachable' });
        if (state.get() === 'DEGRADED' && authStatus === 'logged_in') state.set('RUNNING');
      } catch (e) {
        pollFailuresConsecutive++;
        metrics.inc('poll_failures');
        metrics.inc('agent_error_count');
        health.update({ poll_failures_consecutive: pollFailuresConsecutive, errors_total: health.v.errors_total + 1, agent_wechat: 'unreachable' });
        state.set('DEGRADED');
        logger.warn(`poll failed kind=${e.kind || 'unknown'} fail=${pollFailuresConsecutive} msg=${e.message.slice(0, 120)}`);
        const delay = cfg.backoff[Math.min(backoffIdx, cfg.backoff.length - 1)];
        backoffIdx++;
        await sleep(delay);
      }
      health.update({ last_poll_at: lastPollAt });
      nextPollAt = Date.now() + cfg.poll_ms;
    }
    await sleep(200);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function authLoop() {
  while (!stopping) {
    await authCheck();
    await sleep(cfg.auth_check_interval_ms);
  }
}

async function healthLoop() {
  while (!stopping) {
    health.update({ gateway: 'running', collector: 'running', last_poll_at: lastPollAt, last_successful_poll_at: lastSuccessfulPollAt, agent_wechat: health.v.agent_wechat });
    health.write();
    await sleep(cfg.health_write_interval_ms);
  }
}

async function metricsLoop() {
  while (!stopping) {
    metrics.write();
    metrics.recordSpoolSize(spool.totalBytes());
    await sleep(cfg.metrics_write_interval_ms);
  }
}

async function resourceLoop() {
  while (!stopping) {
    sampleResources();
    await sleep(cfg.resource_sample_interval_ms);
  }
}

// ---------- graceful shutdown ----------
async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  logger.info(`received ${sig}, shutting down gracefully`);
  state.set('STOPPING');
  try { cursor.persist(); } catch (e) { logger.error(`cursor persist failed: ${e.message}`); }
  try { dedup.persist(); } catch (e) { logger.error(`dedup persist failed: ${e.message}`); }
  try { spool.close(); } catch (e) { /* ignore */ }
  try { metrics.write(); } catch (e) { logger.error(`metrics write failed: ${e.message}`); }
  try { health.update({ gateway: 'stopped' }); health.write(); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(PID_FILE); } catch (e) { /* ignore */ }
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---------- main ----------
async function main() {
  logger.info(`gateway starting id=${cfg.gateway_id} pid=${process.pid} poll=${cfg.poll_ms}ms`);
  state.set('STARTING');

  // initial agent reachability + auth
  try {
    await authCheck();
    health.update({ agent_wechat: 'reachable' });
    state.set(authStatus === 'logged_in' ? 'RUNNING' : 'WAITING_FOR_LOGIN');
  } catch (e) {
    state.set('DEGRADED');
  }

  authLoop();
  healthLoop();
  metricsLoop();
  resourceLoop();
  pollLoop();
}

main().catch((e) => {
  logger.error(`fatal: ${e.message}`);
  health.update({ gateway: 'error' });
  health.write();
  process.exit(1);
});
