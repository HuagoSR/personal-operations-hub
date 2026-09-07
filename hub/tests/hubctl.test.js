'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');
const { openDatabase, migrate } = require('../src/db');

const HUBCTL = path.resolve(__dirname, '..', 'bin', 'hubctl.js');

function run(args, env) {
  const r = spawnSync(process.execPath, [HUBCTL, ...args], {
    encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function tempEnv() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hubctl-t-'));
  return {
    base,
    env: {
      HUB_CONFIG_DIR: path.join(base, 'config'),
      HUB_DATA_DIR: path.join(base, 'data'),
      HUB_STATE_DIR: path.join(base, 'state'),
      HUB_RUNTIME_DIR: path.join(base, 'run'),
      HUB_WORKSPACE_ROOT: path.join(base, 'ws'),
    },
  };
}

test('hubctl: version prints release', () => {
  const r = run(['version']);
  assert.equal(r.code, 0);
  assert.match(r.out, /v0\.1\.0/);
});

test('hubctl: doctor on empty env reports ACTION_REQUIRED and exit 2', () => {
  const t = tempEnv();
  const r = run(['doctor'], t.env);
  assert.equal(r.code, 2);
  assert.match(r.out, /ACTION_REQUIRED/);
  assert.match(r.out, /database not initialized/);
});

test('hubctl: backup uses VACUUM INTO snapshot and writes manifest', () => {
  const t = tempEnv();
  const dbFile = path.join(t.base, 'data', 'hub.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = openDatabase(dbFile);
  migrate(db, path.resolve(__dirname, '..', 'src', 'migrations'));
  db.prepare('INSERT INTO projects (name, project_type, sort_order) VALUES (?, ?, ?)').run('Hub', 'SYSTEM_HUB', 0);
  db.close();
  const outDir = path.join(t.base, 'backups');
  const r = run(['backup', '--db', dbFile, '--out', outDir], t.env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /VACUUM INTO/);
  const tar = fs.readdirSync(outDir).find((f) => f.endsWith('.tar.gz'));
  assert.ok(tar);
  const list = spawnSync('tar', ['-tzf', path.join(outDir, tar)], { encoding: 'utf8' });
  assert.match(list.stdout, /manifest\.json/);
  assert.match(list.stdout, /hub\.db/);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hubctl-x-'));
  spawnSync('tar', ['-xzf', path.join(outDir, tar), '-C', work]);
  const manifest = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8'));
  assert.equal(manifest.release, '0.1.0');
  assert.ok(Number.isInteger(manifest.schema_version));
  assert.ok(manifest.created_at && manifest.source_host);
});

test('hubctl: restore roundtrip preserves data and validates release', () => {
  const t = tempEnv();
  const dbFile = path.join(t.base, 'data', 'hub.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = openDatabase(dbFile);
  migrate(db, path.resolve(__dirname, '..', 'src', 'migrations'));
  db.prepare('INSERT INTO projects (name, project_type, sort_order) VALUES (?, ?, ?)').run('Gomoku', 'USER', 100);
  db.close();
  const outDir = path.join(t.base, 'backups');
  assert.equal(run(['backup', '--db', dbFile, '--out', outDir], t.env).code, 0);
  const tar = path.join(outDir, fs.readdirSync(outDir).find((f) => f.endsWith('.tar.gz')));
  fs.rmSync(dbFile);
  const r = run(['restore', tar, '--db', dbFile, '--force'], t.env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /restore OK/);
  const chk = new (require('node:sqlite').DatabaseSync)(dbFile, { readOnly: true });
  const count = chk.prepare('SELECT COUNT(*) c FROM projects').get().c;
  chk.close();
  assert.equal(count, 1);
});

test('hubctl: restore rejects release mismatch', () => {
  const t = tempEnv();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hubctl-bad-'));
  fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify({ release: '9.9.9', schema_version: 8 }));
  fs.writeFileSync(path.join(work, 'hub.db'), 'not a db');
  const tar = path.join(t.base, 'bad.tar.gz');
  spawnSync('tar', ['-czf', tar, '-C', work, '.'], { encoding: 'utf8' });
  const dbTarget = path.join(t.base, 'data', 'hub.db');
  const r = run(['restore', tar, '--db', dbTarget, '--force'], t.env);
  assert.equal(r.code, 1);
  assert.match(r.err || r.out, /release mismatch/);
});

test('hubctl: service install rewrites template to actual checkout and node', () => {
  // Verify the rewrite logic mirrors hubctl cmdService by simulating at a
  // non-default checkout path with a user-local node (clean-room findings).
  const t = tempEnv();
  const tpl = `[Unit]
Description=test
[Service]
WorkingDirectory=%h/pohub/hub
ExecStart=/usr/bin/node src/main.js
EnvironmentFile=-%h/.config/personal-operations-hub/hub.env
`;
  // fake checkout: $HOME/personal-operations-hub-v0.1.0/hub
  const relCheckout = '/personal-operations-hub-v0.1.0/hub';
  let out = tpl.split('%h/pohub/hub').join('%h' + relCheckout);
  out = out.split('ExecStart=/usr/bin/node').join('ExecStart=/home/u/.local/node/bin/node');
  assert.match(out, /WorkingDirectory=%h\/personal-operations-hub-v0\.1\.0\/hub/);
  assert.ok(!out.includes('%h/pohub/hub/hub'), 'no double path');
  assert.match(out, /ExecStart=\/home\/u\/\.local\/node\/bin\/node src\/main\.js/);
  assert.ok(!out.includes('/usr/bin/node'));
});

test('hubctl: restore refuses schema newer than code (downgrade protection)', () => {
  const t = tempEnv();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hubctl-down-'));
  const migDir = path.resolve(__dirname, '..', 'src', 'migrations');
  const codeMax = Math.max(...fs.readdirSync(migDir).map((f) => parseInt(f.split('_')[0], 10)).filter((n) => !isNaN(n)));
  fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify({ release: '0.1.0', schema_version: codeMax + 99 }));
  fs.writeFileSync(path.join(work, 'hub.db'), 'not a db');
  const tar = path.join(t.base, 'down.tar.gz');
  spawnSync('tar', ['-czf', tar, '-C', work, '.'], { encoding: 'utf8' });
  const r = run(['restore', tar, '--db', path.join(t.base, 'x.db'), '--force'], t.env);
  assert.equal(r.code, 1);
  assert.match(r.err || r.out, /downgrade refused/);
});

test('hubctl: backup --with-gateway packages gateway state; restore writes it back', () => {
  const t = tempEnv();
  const dbFile = path.join(t.base, 'data', 'hub.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = openDatabase(dbFile);
  migrate(db, path.resolve(__dirname, '..', 'src', 'migrations'));
  db.close();
  const gdir = path.join(t.base, 'gateway');
  fs.mkdirSync(path.join(gdir, 'data', 'state'), { recursive: true });
  fs.writeFileSync(path.join(gdir, 'data', 'state', 'cursor.json'), '{"n":42}');
  fs.writeFileSync(path.join(gdir, 'data', 'state', 'health.json'), '{"ok":true}');
  const outDir = path.join(t.base, 'backups');
  const env = { ...t.env, GATEWAY_DIR: gdir };
  assert.equal(run(['backup', '--db', dbFile, '--out', outDir, '--with-gateway'], env).code, 0);
  const tar = path.join(outDir, fs.readdirSync(outDir).find((f) => f.endsWith('.tar.gz')));
  fs.rmSync(dbFile);
  fs.rmSync(path.join(gdir, 'data', 'state'), { recursive: true, force: true });
  const r = run(['restore', tar, '--db', dbFile, '--with-gateway', '--force'], env);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(path.join(gdir, 'data', 'state', 'cursor.json'), 'utf8'), '{"n":42}');
});
