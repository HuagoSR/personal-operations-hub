'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');
const { DEFAULTS, load, pathModel } = require('../src/config');

test('R0-B: config defaults follow the portable path model', () => {
  const M = pathModel();
  const srcText = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'config.js'), 'utf8');
  assert.ok(!/\/home\/huagosr/.test(srcText), 'no personal username in config source');
  assert.ok(!/wechat-linux-research/.test(srcText), 'no legacy project root in config source');
  assert.equal(DEFAULTS.dataDir, M.dataDir);
  assert.ok(DEFAULTS.workerAllowedRoots.includes(M.workspaceRoot));
  assert.equal(DEFAULTS.selfDevWorkspace, path.join(M.workspaceRoot, 'hub-dev'));
  assert.equal(DEFAULTS.codexBinary, '', 'codex discovered via PATH by default');
});

test('R0-B: env overrides win, tilde expansion in config.json works', () => {
  const old = process.env.HUB_DATA_DIR;
  process.env.HUB_DATA_DIR = '/tmp/r0b-test-data';
  try {
    assert.equal(pathModel().dataDir, '/tmp/r0b-test-data');
  } finally {
    if (old === undefined) delete process.env.HUB_DATA_DIR; else process.env.HUB_DATA_DIR = old;
  }
  const tmp = path.join(os.tmpdir(), `r0b-cfg-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ dataDir: '~/legacy-data', workerAllowedRoots: ['~/legacy-ws'] }));
  const cfg = load(tmp);
  assert.equal(cfg.dataDir, path.join(os.homedir(), 'legacy-data'), 'tilde expanded');
  assert.equal(cfg.workerAllowedRoots[0], path.join(os.homedir(), 'legacy-ws'));
  fs.unlinkSync(tmp);
});

test('R0-B: shipped source tree is free of hardcoded paths and secrets', () => {
  const root = path.resolve(__dirname, '..');
  const scanDirs = [path.join(root, 'src'), path.join(root, 'config')];
  const ops = ['personal-hub.service', 'personal-hub-selftest.service', 'personal-hub-selftest.timer',
    'selftest.js', 'smoke.js', 'start.sh', 'stop.sh', 'status.sh', 'apply-hub.sh', 'rollback-hub.sh',
    'prepare-update.sh', 'enforcement-test.sh', 'intelligence-shadow.js', 'intelligence-observe.js'];
  const banned = [/\/home\/[a-z0-9_-]+/i, /wechat-linux-research/, /\/usr\/bin\/codex/, /wxid_[a-z0-9]{12,}/, /sk-[A-Za-z0-9]{16,}/];
  const checkFile = (f) => {
    const text = fs.readFileSync(f, 'utf8');
    for (const re of banned) assert.ok(!re.test(text), `${path.relative(root, f)} contains ${re}`);
  };
  for (const d of scanDirs) {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'vendor' || e.name === 'config.json') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) checkFile(p);
      }
    };
    walk(d);
  }
  for (const s of ops) {
    const p = path.join(root, 'scripts', s);
    if (fs.existsSync(p)) checkFile(p);
  }
});

test('R0-B: release-check flags violations and respects allowlists', () => {
  const script = path.resolve(__dirname, '..', 'scripts', 'release-check.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r0b-scan-'));
  try {
    // clean tree passes
    fs.writeFileSync(path.join(tmp, 'ok.js'), 'module.exports = 1;\n');
    let out = execFileSync(process.execPath, [script, tmp], { encoding: 'utf8' });
    assert.match(out, /PASS/);
    // violation tree fails
    const badDir = path.join(tmp, 'bad');
    fs.mkdirSync(badDir);
    fs.writeFileSync(path.join(badDir, 'x.js'), 'const p = "/home/huagosr/secret"; const k = "sk-1234567890abcdef1234";\n');
    try {
      execFileSync(process.execPath, [script, badDir], { encoding: 'utf8' });
      assert.fail('expected release-check to fail');
    } catch (e) {
      const out = String(e.stdout || '') + String(e.stderr || '');
      assert.match(out, /portability specific-user-home/);
      assert.match(out, /SECRET api-key/);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
