#!/usr/bin/env node
'use strict';
// hubctl — single CLI entrypoint for Personal Operations Hub (Release R0-C).
// Node >= 22.13, zero dependencies. Reuses the hub config loader / path model.
//
// Commands:
//   version                     print release version
//   status                      service + web health snapshot
//   doctor [--deep]             full health matrix -> READY|DEGRADED|ACTION_REQUIRED
//   onboard                     interactive first-time setup
//   start|stop|restart [--all]  systemd service control (personal-hub, optional gateway)
//   service install|uninstall   install/remove systemd units for this checkout
//   backup [--db PATH] [--out DIR] [--with-gateway]
//   restore <backup.tar.gz> [--db PATH]
//   help
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const readline = require('readline/promises');

const HUB_ROOT = path.resolve(__dirname, '..');
const RELEASE = (() => {
  const v = path.join(HUB_ROOT, '..', 'VERSION');
  if (fs.existsSync(v)) return fs.readFileSync(v, 'utf8').trim().replace(/^v/, '');
  try { return require(path.join(HUB_ROOT, 'package.json')).version; } catch (e) { return '0.0.0'; }
})();

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

// Shared env file (same one the shell scripts source): apply unless already set.
function loadEnvFile() {
  const f = process.env.HUB_ENV_FILE || path.join(os.homedir(), '.config', 'personal-operations-hub', 'hub.env');
  try {
    if (!fs.existsSync(f)) return;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      if (process.env[key] === undefined) process.env[key] = m[2].replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_, k) => process.env[k] || '');
    }
  } catch (e) { }
}

function gatewayHealth() {
  const gdir = process.env.GATEWAY_DIR || path.join(HUB_ROOT, '..', 'gateway');
  const h = path.join(gdir, 'data', 'state', 'health.json');
  try {
    if (!fs.existsSync(h)) return null;
    return JSON.parse(fs.readFileSync(h, 'utf8'));
  } catch (e) { return null; }
}

function loadHubConfig() {
  const { load } = require(path.join(HUB_ROOT, 'src', 'config'));
  return load(process.env.HUB_CONFIG || path.join(HUB_ROOT, 'config', 'config.json'));
}

function resolveDb(cfg, opts) {
  if (opts.db) return path.resolve(opts.db);
  if (cfg.dbPath) return path.isAbsolute(cfg.dbPath) ? cfg.dbPath : path.join(HUB_ROOT, cfg.dbPath);
  return path.join(cfg.dataDir, 'hub.db');
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout || 20000, ...opts.spawn });
  return { code: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), error: r.error };
}

function which(bin) {
  const r = sh(process.platform === 'win32' ? 'where' : 'which', [bin]);
  return r.code === 0 ? r.stdout.split(/\r?\n/)[0] : null;
}

function isLinux() { return process.platform === 'linux'; }
function hasSystemdUser() {
  return sh('systemctl', ['--user', 'is-system-running']).code === 0;
}

// ---------- version ----------
function cmdVersion() {
  console.log(`Personal Operations Hub v${RELEASE}`);
}

// ---------- status ----------
function cmdStatus(cfg) {
  const M = pathModel();
  console.log(`release: v${RELEASE}`);
  console.log(`dataDir: ${cfg.dataDir}${cfg.dataDir !== M.dataDir ? ' (LEGACY_COMPAT)' : ''}`);
  const hub = sh('systemctl', ['--user', 'is-active', 'personal-hub']);
  console.log(`personal-hub: ${hub.code === 0 ? hub.stdout : 'inactive'}`);
  const gw = sh('systemctl', ['--user', 'is-active', 'wechat-gateway']);
  console.log(`wechat-gateway: ${gw.code === 0 ? gw.stdout : 'inactive'}`);
  const http = sh(process.platform === 'win32' ? 'curl' : 'curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `http://127.0.0.1:${cfg.port || 8300}/api/status`]);
  console.log(`web health: ${http.code === 0 && http.stdout === '200' ? 'OK (200)' : 'unreachable'}`);
}

// ---------- doctor ----------
async function cmdDoctor(cfg, opts) {
  const M = pathModel();
  const issues = [];
  const checks = {};

  checks.system = (() => {
    const ok = isLinux() && sh('node', ['--version']).code === 0 && which('bwrap') && hasSystemdUser();
    if (!isLinux()) issues.push('system: non-Linux host');
    if (!which('bwrap')) issues.push('system: bwrap missing');
    if (!hasSystemdUser()) issues.push('system: systemd --user unavailable');
    return ok;
  })();

  checks.codex = (() => {
    const bin = cfg.codexBinary || which('codex');
    if (!bin) { issues.push('codex: not found on PATH (v0.1.0 requires preinstalled, logged-in Codex)'); return false; }
    const v = sh(bin, ['--version'], { timeout: 15000 });
    if (v.code !== 0) { issues.push('codex: --version failed'); return false; }
    const login = sh(bin, ['login', 'status'], { timeout: 30000 });
    if (login.code !== 0) issues.push('codex: login status unknown/not authenticated (user-managed)');
    return true;
  })();

  checks.hub = (() => {
    const dbPath = resolveDb(cfg, opts);
    const dbExists = fs.existsSync(dbPath);
    let schemaOk = true;
    if (dbExists) {
      const { DatabaseSync } = require('node:sqlite');
      try {
        const db = new DatabaseSync(dbPath, { readOnly: true });
        const integ = db.prepare('PRAGMA integrity_check').get();
        if (String(Object.values(integ)[0]) !== 'ok') { issues.push('hub: db integrity_check failed'); schemaOk = false; }
        const mig = db.prepare('SELECT COALESCE(MAX(version),0) v FROM schema_migrations').get();
        checks.schemaVersion = Number(mig.v);
        db.close();
      } catch (e) {
        issues.push(`hub: cannot open db (${e.message})`); schemaOk = false;
      }
    } else {
      issues.push('hub: database not initialized (run onboard or start once)');
      schemaOk = false;
    }
    const unit = sh('systemctl', ['--user', 'list-unit-files', 'personal-hub.service']);
    if (!/personal-hub\.service/.test(unit.stdout || '')) issues.push('hub: systemd unit not installed');
    return dbExists && schemaOk;
  })();

  checks.wechat = (() => {
    if (!which('docker')) { issues.push('wechat: docker missing (optional integration)'); return false; }
    const c = sh('docker', ['ps', '--format', '{{.Names}}']);
    const name = cfg.wechatContainerName || process.env.WECHAT_CONTAINER_NAME || 'wx-research-agent-wechat';
    if (!(c.stdout || '').includes(name)) { issues.push(`wechat: container ${name} not running (optional)`); return false; }
    const gh = gatewayHealth();
    if (!gh) { issues.push('wechat: gateway health state unavailable'); return false; }
    if (gh.agent_wechat !== 'reachable') issues.push(`wechat: agent-server ${gh.agent_wechat || 'unknown'}`);
    if (gh.wechat_auth !== 'logged_in') issues.push(`wechat: auth ${gh.wechat_auth || 'unknown'}`);
    return gh.agent_wechat === 'reachable';
  })();

  checks.intelligence = (() => {
    if (!cfg.intelligenceEnabled) return null; // not enabled = fine
    const keyFile = cfg.intelligenceApiKeyFile;
    const hasKey = (keyFile && fs.existsSync(keyFile)) || !!cfg.intelligenceApiKey;
    if (!hasKey) issues.push('intelligence: api key missing');
    const budget = (() => {
      try {
        const dbPath = resolveDb(cfg, opts);
        if (fs.existsSync(dbPath)) {
          const { DatabaseSync } = require('node:sqlite');
          const db = new DatabaseSync(dbPath, { readOnly: true });
          const r = db.prepare(`SELECT COALESCE(SUM(estimated_cost),0) m, COALESCE(SUM(CASE WHEN substr(created_at,1,10)=date('now') THEN estimated_cost END),0) d FROM intelligence_analyses WHERE status='COMPLETED'`).get();
          db.close();
          if (Number(r.m) >= cfg.intelligenceBudgetMonthlyUsd) issues.push('intelligence: monthly budget exhausted');
          if (Number(r.d) >= cfg.intelligenceBudgetDailyUsd) issues.push('intelligence: daily budget exhausted');
        }
      } catch (e) { }
    })();
    return hasKey;
  })();

  checks.data = (() => {
    const bkDir = process.env.HUB_BACKUP_DIR || path.join(cfg.dataDir, '..', 'backups');
    let newest = null;
    try {
      const files = fs.readdirSync(bkDir).filter((f) => f.startsWith('hub-') && f.endsWith('.tar.gz')).sort();
      newest = files.length ? files[files.length - 1] : null;
    } catch (e) { }
    if (!newest) issues.push('data: no backup found yet');
    return !!newest;
  })();

  if (opts.deep) {
    // deep: disk headroom on the data partition
    const df = sh('df', ['-P', '-k', path.dirname(resolveDb(cfg, opts))]);
    if (df.code === 0) {
      const line = (df.stdout || '').split('\n')[1];
      const avail = line ? parseInt(line.trim().split(/\s+/)[3], 10) : NaN;
      if (!isNaN(avail) && avail < 1024 * 1024) issues.push(`system: disk headroom low (${(avail / 1024).toFixed(0)} MiB)`);
      else console.log(`  disk headroom: ${isNaN(avail) ? 'n/a' : (avail / 1024 / 1024).toFixed(1)} GiB`);
    }
    // deep: codex app-server can start (spawn briefly, poll readyz, then kill)
    const codexBin = cfg.codexBinary || which('codex');
    if (codexBin) {
      const port = 49000 + Math.floor(Math.random() * 1000);
      const child = require('child_process').spawn(codexBin, ['app-server', '--listen', `ws://127.0.0.1:${port}`], { stdio: 'ignore' });
      let ok = false;
      const deadline = Date.now() + 15000;
      const timer = setInterval(() => {
        try {
          const r = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `http://127.0.0.1:${port}/readyz`], { encoding: 'utf8', timeout: 3000 });
          if (r.stdout === '200') ok = true;
        } catch (e) { }
        if (ok || Date.now() > deadline) { clearInterval(timer); try { child.kill('SIGTERM'); } catch (e) { } }
      }, 1500);
      const wait = new Promise((resolve) => setTimeout(resolve, 16000));
      // eslint-disable-next-line no-unused-vars
      await wait;
      if (ok) console.log('  codex app-server: startable');
      else issues.push('codex: app-server failed to start within 15s');
    }
  }

  const layout = cfg.dataDir !== M.dataDir ? 'LEGACY_COMPAT' : 'PORTABLE';
  let verdict;
  if (issues.some((i) => i.startsWith('system:') || i.startsWith('hub: database') || i.startsWith('codex: not found'))) verdict = 'ACTION_REQUIRED';
  else if (issues.length) verdict = 'DEGRADED';
  else verdict = 'READY';

  console.log(`doctor: ${verdict}`);
  console.log(`data layout: ${layout}${layout === 'LEGACY_COMPAT' ? ' (explicit legacy config, OK)' : ''}`);
  console.log(`schema_version: ${checks.schemaVersion !== undefined ? checks.schemaVersion : 'n/a'}`);
  if (issues.length) for (const i of issues) console.log('  - ' + i);
  else console.log('  all checks passed');
  process.exitCode = verdict === 'ACTION_REQUIRED' ? 2 : (verdict === 'DEGRADED' ? 1 : 0);
}

// ---------- backup ----------
function cmdBackup(cfg, opts) {
  const dbPath = resolveDb(cfg, opts);
  if (!fs.existsSync(dbPath)) { console.error(`db not found: ${dbPath}`); process.exit(1); }
  const { DatabaseSync } = require('node:sqlite');
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const outDir = opts.out || process.env.HUB_BACKUP_DIR || path.join(cfg.dataDir, '..', 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hubbackup-'));
  const snapshot = path.join(work, 'hub.db');

  // Consistency snapshot via SQLite VACUUM INTO — never copy a live WAL db.
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const mig = db.prepare('SELECT COALESCE(MAX(version),0) v FROM schema_migrations').get();
  db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  db.close();

  // verify the snapshot before packaging
  const snapDb = new DatabaseSync(snapshot, { readOnly: true });
  const integ = snapDb.prepare('PRAGMA integrity_check').get();
  if (String(Object.values(integ)[0]) !== 'ok') {
    snapDb.close();
    fs.rmSync(work, { recursive: true, force: true });
    console.error('snapshot integrity_check failed — backup aborted');
    process.exit(1);
  }
  snapDb.close();

  const manifest = {
    release: RELEASE,
    schema_version: Number(mig.v),
    created_at: new Date().toISOString(),
    source_host: os.hostname(),
    components: { hub: 'v' + RELEASE, gateway: opts.withGateway ? 'included' : 'not-included' },
    db_file: 'hub.db',
    snapshot_method: 'VACUUM INTO',
  };
  fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const verFile = path.join(HUB_ROOT, '..', 'VERSION');
  if (fs.existsSync(verFile)) fs.copyFileSync(verFile, path.join(work, 'VERSION'));

  if (opts.withGateway) {
    const gdir = process.env.GATEWAY_DIR || path.join(HUB_ROOT, '..', 'gateway');
    const st = path.join(gdir, 'data', 'state');
    if (fs.existsSync(st)) {
      const dst = path.join(work, 'gateway-state');
      fs.mkdirSync(dst);
      for (const f of ['cursor.json', 'dedup.json', 'health.json']) {
        const s = path.join(st, f);
        if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dst, f));
      }
    }
  }

  const tarname = `hub-backup-${stamp}.tar.gz`;
  const tarPath = path.join(outDir, tarname);
  const r = sh('tar', ['-czf', tarPath, '-C', work, '.'], { timeout: 120000 });
  fs.rmSync(work, { recursive: true, force: true });
  if (r.code !== 0) { console.error(`tar failed: ${r.stderr}`); process.exit(1); }
  const size = fs.statSync(tarPath).size;
  console.log(`backup OK: ${tarPath}`);
  console.log(`  release=${RELEASE} schema_version=${manifest.schema_version} size=${(size / 1024).toFixed(1)} KiB`);
  console.log(`  db snapshot method: VACUUM INTO (WAL-safe)`);
}

// ---------- restore ----------
function cmdRestore(cfg, opts) {
  const tarPath = path.resolve(opts.tar);
  if (!fs.existsSync(tarPath)) { console.error(`backup not found: ${tarPath}`); process.exit(1); }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hubrestore-'));
  const r = sh('tar', ['-xzf', tarPath, '-C', work], { timeout: 120000 });
  if (r.code !== 0) { console.error(`tar failed: ${r.stderr}`); process.exit(1); }
  const manifestPath = path.join(work, 'manifest.json');
  if (!fs.existsSync(manifestPath)) { console.error('manifest.json missing — not a valid hub backup'); process.exit(1); }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { console.error('manifest invalid JSON'); process.exit(1); }
  if (String(manifest.release) !== String(RELEASE)) {
    console.error(`release mismatch: backup=${manifest.release} current=${RELEASE}`);
    process.exit(1);
  }
  if (!Number.isInteger(manifest.schema_version) || manifest.schema_version < 1) {
    console.error(`schema_version invalid: ${manifest.schema_version}`);
    process.exit(1);
  }
  // downgrade protection: refuse backups newer than this code's migrations
  const migDir = path.join(HUB_ROOT, 'src', 'migrations');
  let maxMig = 0;
  try {
    for (const f of fs.readdirSync(migDir)) {
      const v = parseInt(f.split('_')[0], 10);
      if (!isNaN(v) && v > maxMig) maxMig = v;
    }
  } catch (e) { }
  if (manifest.schema_version > maxMig) {
    console.error(`schema downgrade refused: backup=${manifest.schema_version} > code migrations=${maxMig}`);
    process.exit(1);
  }
  const srcDb = path.join(work, 'hub.db');
  if (!fs.existsSync(srcDb)) { console.error('hub.db missing in backup'); process.exit(1); }
  const dbPath = resolveDb(cfg, opts);
  const active = sh('systemctl', ['--user', 'is-active', 'personal-hub']);
  if (active.stdout === 'active' && !opts.force) {
    console.error('personal-hub is active — stop it first (hubctl stop) or pass --force');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  if (fs.existsSync(dbPath)) fs.renameSync(dbPath, `${dbPath}.pre-restore-${stamp}`);
  fs.copyFileSync(srcDb, dbPath);
  const { DatabaseSync } = require('node:sqlite');
  const check = new DatabaseSync(dbPath, { readOnly: true });
  const mig = check.prepare('SELECT COALESCE(MAX(version),0) v FROM schema_migrations').get();
  check.close();
  console.log(`restore OK: ${dbPath}`);
  console.log(`  schema_version=${mig.v} (backup said ${manifest.schema_version})`);
  const gwState = path.join(work, 'gateway-state');
  if (fs.existsSync(gwState)) {
    if (opts.withGateway) {
      const gdir = process.env.GATEWAY_DIR || path.join(HUB_ROOT, '..', 'gateway');
      const st = path.join(gdir, 'data', 'state');
      fs.mkdirSync(st, { recursive: true });
      for (const f of fs.readdirSync(gwState)) {
        const dst = path.join(st, f);
        if (fs.existsSync(dst)) fs.copyFileSync(dst, `${dst}.pre-restore-${stamp}`);
        fs.copyFileSync(path.join(gwState, f), dst);
      }
      console.log('  gateway state restored (cursor/dedup/health)');
    } else {
      console.log('  gateway state present in backup; re-run with --with-gateway to restore it');
    }
  }
  fs.rmSync(work, { recursive: true, force: true });
  console.log('  run: hubctl doctor');
}

// ---------- service control ----------
function cmdService(action) {
  const unit = 'personal-hub.service';
  const units = [unit];
  const script = path.join(HUB_ROOT, 'scripts', unit);
  const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  if (action === 'install') {
    fs.mkdirSync(unitDir, { recursive: true });
    for (const u of units) {
      let content = fs.readFileSync(path.join(HUB_ROOT, 'scripts', u), 'utf8');
      content = content.split('%h/pohub').join(`%h${HUB_ROOT.split(os.homedir())[1] || ''}`.replace(/\\/g, '/'));
      fs.writeFileSync(path.join(unitDir, u), content);
    }
    sh('systemctl', ['--user', 'daemon-reload']);
    sh('systemctl', ['--user', 'enable', 'personal-hub']);
    console.log('service installed (personal-hub)');
  } else if (action === 'uninstall') {
    sh('systemctl', ['--user', 'disable', '--now', 'personal-hub']);
    fs.rmSync(path.join(unitDir, unit), { force: true });
    sh('systemctl', ['--user', 'daemon-reload']);
    console.log('service uninstalled');
  } else {
    console.error('usage: hubctl service install|uninstall');
    process.exit(1);
  }
}

function cmdSvc(action, opts) {
  const targets = opts.all ? ['personal-hub', 'wechat-gateway'] : ['personal-hub'];
  for (const t of targets) {
    const r = sh('systemctl', ['--user', action, t]);
    console.log(`${action} ${t}: ${r.code === 0 ? 'ok' : r.stderr || 'failed'}`);
    if (r.code !== 0) process.exitCode = 1;
  }
}

// ---------- onboard ----------
async function cmdOnboard(cfg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, dflt) => {
    const a = await rl.question(`${q} [${dflt}]: `);
    return a.trim() || dflt;
  };
  console.log(`Personal Operations Hub v${RELEASE} — onboard`);
  console.log('');
  console.log('System Check');
  console.log(`${isLinux() ? '✓' : '✗'} Linux`);
  console.log(`${which('node') ? '✓' : '✗'} Node`);
  console.log(`${which('bwrap') ? '✓' : '✗'} bubblewrap`);
  console.log(`${hasSystemdUser() ? '✓' : '✗'} systemd --user`);
  console.log('');
  const codexBin = which('codex');
  console.log(`${codexBin ? '✓' : '✗'} Codex installed${codexBin ? '' : ' (v0.1.0 requires preinstalled + logged-in Codex; Hub does not install/login it)'}`);
  console.log('');
  const M = pathModel();
  console.log('Install directories:');
  console.log(`  config: ${M.configDir}`);
  console.log(`  data:   ${M.dataDir}`);
  console.log(`  state:  ${M.stateDir}`);
  console.log(`  workspace: ${M.workspaceRoot}`);
  console.log(`  web: 127.0.0.1:${cfg.port}`);
  console.log('');
  const useWechat = (await ask('Enable WeChat integration?', 'n')).toLowerCase().startsWith('y');
  const useIntel = (await ask('Enable DeepSeek Intelligence?', 'n')).toLowerCase().startsWith('y');
  let intelKey = '';
  if (useIntel) {
    intelKey = await ask('Enter DeepSeek API key (write once, never stored in repo)', '');
    if (!intelKey) console.log('  (no key entered — intelligence stays disabled until configured)');
  }
  const installSvc = (await ask('Install and start systemd service?', 'y')).toLowerCase().startsWith('y');
  rl.close();

  const configPath = process.env.HUB_CONFIG || path.join(HUB_ROOT, 'config', 'config.json');
  const outCfg = {
    port: cfg.port,
    host: '127.0.0.1',
    dataDir: M.dataDir,
    spoolDir: path.join(M.dataDir, 'gateway', 'spool'),
    workerDefaultWorkspace: path.join(M.workspaceRoot, 'default'),
    workerAllowedRoots: [M.workspaceRoot],
    selfDevWorkspace: path.join(M.workspaceRoot, 'hub-dev'),
    codexBinary: '',
  };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(outCfg, null, 2) + '\n');
  console.log(`config written: ${configPath}`);

  fs.mkdirSync(M.dataDir, { recursive: true });
  fs.mkdirSync(M.stateDir, { recursive: true });
  fs.mkdirSync(M.workspaceRoot, { recursive: true });

  if (useIntel && intelKey) {
    const secDir = path.join(M.configDir, 'secrets');
    fs.mkdirSync(secDir, { recursive: true, mode: 0o700 });
    const f = path.join(secDir, 'intelligence.env');
    fs.writeFileSync(f, `HUB_INTELLIGENCE_API_KEY=${intelKey}\n`, { mode: 0o600 });
    console.log(`intelligence key written: ${f} (600)`);
  }

  if (useWechat) {
    console.log('WeChat integration is an external dependency (see THIRD_PARTY.md):');
    console.log('  1. docker compose (deploy/docker-compose.yml, pinned validated image)');
    console.log('  2. follow docs/manuals/WECHAT_LOGIN_GUIDE.md for login');
  }

  if (installSvc && hasSystemdUser()) {
    cmdService('install');
    cmdSvc('start', {});
  }

  // make `hubctl` available on PATH (best effort)
  const binDir = path.join(os.homedir(), '.local', 'bin');
  try {
    fs.mkdirSync(binDir, { recursive: true });
    const link = path.join(binDir, 'hubctl');
    if (!fs.existsSync(link)) fs.symlinkSync(path.join(HUB_ROOT, 'bin', 'hubctl.js'), link);
    console.log(`hubctl linked: ${link} (ensure ~/.local/bin is on PATH)`);
  } catch (e) {
    console.log(`(hubctl symlink skipped: ${e.message})`);
  }

  console.log('');
  console.log('onboard complete. Run: hubctl doctor');
}

// ---------- dispatch ----------
async function main() {
  loadEnvFile();
  const args = process.argv.slice(2);
  const cmd = args[0] || 'help';
  const flag = (name) => args.includes(name);
  const val = (name) => {
    const i = args.indexOf(name);
    return i > -1 && args[i + 1] ? args[i + 1] : undefined;
  };
  const opts = { db: val('--db'), out: val('--out'), tar: val('--tar') || args[1], force: flag('--force'), all: flag('--all'), deep: flag('--deep'), withGateway: flag('--with-gateway') };
  const cfg = loadHubConfig();

  switch (cmd) {
    case 'version': cmdVersion(); break;
    case 'status': cmdStatus(cfg); break;
    case 'doctor': await cmdDoctor(cfg, opts); break;
    case 'backup': cmdBackup(cfg, opts); break;
    case 'restore': cmdRestore(cfg, opts); break;
    case 'start': case 'stop': case 'restart': cmdSvc(cmd, opts); break;
    case 'service': cmdService(args[1]); break;
    case 'onboard': await cmdOnboard(cfg); break;
    default:
      console.log(`hubctl v${RELEASE}
usage:
  hubctl version
  hubctl status
  hubctl doctor [--deep]
  hubctl onboard
  hubctl start|stop|restart [--all]
  hubctl service install|uninstall
  hubctl backup [--db PATH] [--out DIR] [--with-gateway]
  hubctl restore <backup.tar.gz> [--db PATH] [--force]`);
  }
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
