'use strict';
const path = require('path');
const { openDatabase, migrate } = require('./db');
const { load, resolveDbPath } = require('./config');
const { Logger } = require('./logger');
const { ingestOnce } = require('./services/ingest');
const { consumeOutboxOnce, pumpOnce } = require('./services/dispatcher');
const { sweepOnce } = require('./services/sweep');
const { createServer } = require('./api/server');
const intelligence = require('./intelligence/service');

const ROOT = path.join(__dirname, '..');
const cfg = load(process.env.HUB_CONFIG || path.join(ROOT, 'config', 'config.json'));
const logger = new Logger({ level: cfg.logLevel });
const dbPath = resolveDbPath(cfg, ROOT);
const db = openDatabase(dbPath);
migrate(db, path.join(__dirname, 'migrations'));

try {
  const boot = require('./services/bootstrap').ensureSystemEntities(db);
  logger.info(`bootstrap ok globalConv=${boot.globalConversation.id} hubProject=${boot.hubProject.id} hubGeneral=${boot.hubGeneralConversation.id}`);
} catch (e) {
  logger.error(`bootstrap failed: ${e.stack || e.message}`);
}

const ctx = {
  cfg,
  logger,
  clock: {
    iso: () => new Date().toISOString(),
    ms: () => Date.now(),
  },
  workerRuntime: require('./services/worker-runtime'),
};

const server = createServer(db, ctx, cfg);
server.listen(cfg.port, cfg.host, () => {
  logger.info(`hub listening on http://${cfg.host}:${cfg.port} db=${dbPath} spool=${cfg.spoolDir}`);
});

let stopping = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loop(fn, ms, name) {
  while (!stopping) {
    const t = Date.now();
    try {
      await fn();
    } catch (e) {
      logger.error(`${name} error: ${e.stack || e.message}`);
    }
    const elapsed = Date.now() - t;
    await sleep(Math.max(50, ms - elapsed));
  }
}

loop(() => {
  if (cfg.ingestEnabled) {
    let intelHook = null;
    if (cfg.intelligenceEnabled) {
      intelHook = (db, m) => {
        try {
          intelligence.onInboxMessageIngested(db, cfg, m);
        } catch (e) {
          logger.warn(`intelligence hook failed: ${e.message}`);
        }
      };
    }
    const r = ingestOnce(db, { spoolDir: cfg.spoolDir, inboxRule: cfg.inboxRule, logger, intelHook });
    if (r.ingested > 0 || r.errors > 0) {
      logger.info(`ingest files=${r.files} new=${r.ingested} dup=${r.duplicates} err=${r.errors}`);
    }
  }
}, cfg.ingestIntervalMs, 'ingest');

loop(() => {
  consumeOutboxOnce(db, ctx);
}, cfg.dispatcherIntervalMs, 'dispatcher');

loop(() => pumpOnce(db, ctx), cfg.pumpIntervalMs, 'pump');

loop(() => {
  if (cfg.intelligenceEnabled) {
    const r = intelligence.sweepEpisodesOnce(db, cfg);
    if (r.enqueued > 0) logger.info(`intelligence sweep closed=${r.closed} enqueued=${r.enqueued}`);
  }
}, cfg.intelligenceSweepIntervalMs, 'intel-sweep');

loop(() => {
  if (!cfg.intelligenceEnabled) return;
  intelligence.processIntelligenceOnce(db, ctx).then((r) => {
    if (r.disabled) return;
    if (r.budgetBlocked) {
      logger.warn(`intelligence budget blocked month=$${r.budget.month.toFixed(3)} day=$${r.budget.today.toFixed(3)}`);
      return;
    }
    if (r.processed > 0) logger.info(`intelligence processed=${r.processed}`);
  }).catch((e) => logger.error(`intelligence process error: ${e.message}`));
}, cfg.intelligenceProcessIntervalMs, 'intel-process');

loop(() => {
  const r = sweepOnce(db, ctx);
  if (r.approvals > 0) logger.info(`sweep expired_approvals=${r.approvals}`);
  if (r.timeouts > 0) logger.info(`sweep timed_out_executions=${r.timeouts}`);
}, cfg.sweepIntervalMs, 'sweep');

function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  logger.info(`received ${sig}, shutting down`);
  try { ctx.workerRuntime.shutdownAll(); } catch (e) { }
  server.close(() => {
    try { db.close(); } catch (e) { }
    logger.info('shutdown complete');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
