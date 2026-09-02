'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const i18n = require('../src/web/i18n');

const webDir = path.join(__dirname, '..', 'src', 'web');

test('i18n: zh and en dictionaries have identical key sets', () => {
  const zh = Object.keys(i18n.DICT.zh).sort();
  const en = Object.keys(i18n.DICT.en).sort();
  assert.deepStrictEqual(en, zh);
  assert.ok(zh.length > 150, 'dictionary should be substantial');
});

test('i18n: no empty values in either dictionary', () => {
  for (const [lang, dict] of Object.entries(i18n.DICT)) {
    for (const [key, value] of Object.entries(dict)) {
      assert.ok(typeof value === 'string' && value.length > 0, `${lang}.${key} has empty value`);
    }
  }
});

test('i18n: t() returns zh values in node (no localStorage) and falls back to key', () => {
  assert.strictEqual(i18n.t('common.approve'), '批准');
  assert.strictEqual(i18n.t('definitely.not.a.key'), 'definitely.not.a.key');
});

test('i18n: status label maps are consistent and complete', () => {
  const zh = Object.keys(i18n.STATUS_ZH).sort();
  const en = Object.keys(i18n.STATUS_EN).sort();
  assert.deepStrictEqual(en, zh);
  assert.ok(zh.length >= 30, 'status maps should cover all known states');
  for (const k of zh) {
    assert.ok(i18n.STATUS_ZH[k].length > 0, `STATUS_ZH.${k} empty`);
    assert.ok(i18n.STATUS_EN[k].length > 0, `STATUS_EN.${k} empty`);
  }
  assert.strictEqual(i18n.statusLabel('RUNNING'), '运行中');
  assert.strictEqual(i18n.statusLabel('UNKNOWN_STATE'), 'UNKNOWN_STATE');
});

test('i18n: every key referenced by pages and app.js exists in both dictionaries', () => {
  const errors = [];
  const files = fs.readdirSync(webDir).filter((f) => f.endsWith('.html'));
  files.push('app.js');
  const keyAttr = /data-i18n(?:-ph|-title)?="([a-z0-9_.-]+)"/g;
  const tCall = /\bt\('([a-z0-9_.]+)'\)/g;
  for (const f of files) {
    const text = fs.readFileSync(path.join(webDir, f), 'utf8');
    let m;
    while ((m = keyAttr.exec(text))) {
      if (!(m[1] in i18n.DICT.zh)) errors.push(`${f}: data-i18n key missing in zh: ${m[1]}`);
      if (!(m[1] in i18n.DICT.en)) errors.push(`${f}: data-i18n key missing in en: ${m[1]}`);
    }
    while ((m = tCall.exec(text))) {
      if (!(m[1] in i18n.DICT.zh)) errors.push(`${f}: t() key missing: ${m[1]}`);
      if (!(m[1] in i18n.DICT.en)) errors.push(`${f}: t() key missing in en: ${m[1]}`);
    }
  }
  assert.deepStrictEqual(errors, []);
});

test('i18n: dynamic key families used by app.js are complete', () => {
  for (const k of ['theme.auto', 'theme.light', 'theme.dark', 'theme.switch', 'lang.switch']) {
    assert.ok(k in i18n.DICT.zh && k in i18n.DICT.en, `missing ${k}`);
  }
  const caps = ['read_project', 'write_project', 'run_project_commands', 'run_tests', 'install_dependencies',
    'network', 'git_commit', 'git_push', 'sudo', 'system_config', 'outside_project'];
  for (const c of caps) {
    assert.ok(('cap.' + c) in i18n.DICT.zh, `missing zh cap.${c}`);
    assert.ok(('cap.' + c) in i18n.DICT.en, `missing en cap.${c}`);
  }
});
