'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { grantToConfig } = require('../src/workers/opencode-worker');
const { grantToSandbox } = require('../src/workers/codex-worker');

function grant(caps) {
  return { capabilities_json: JSON.stringify(caps) };
}

test('opencode grant mapping: allow/ask/deny per capability', () => {
  const g = grant({ write_project: 'allow', run_project_commands: 'ask', network: 'deny' });
  const c = grantToConfig(g);
  assert.equal(c.permission.edit, 'allow');
  assert.equal(c.permission.bash, 'ask');
  assert.equal(c.permission.webfetch, 'deny');
  const d = grant({});
  const cd = grantToConfig(d);
  assert.equal(cd.permission.edit, 'ask');
  assert.equal(cd.permission.bash, 'ask');
  assert.equal(cd.permission.webfetch, 'ask');
});

test('codex sandbox mapping: network deny -> command-deny + no networkAccess', () => {
  const g = grant({ network: 'deny', write_project: 'allow' });
  const s = grantToSandbox(g, '/ws');
  assert.equal(s.networkMode, 'command-deny');
  assert.equal(s.sandboxPolicy.networkAccess, false);
  assert.equal(s.sandboxPolicy.type, 'workspaceWrite');
});

test('codex sandbox mapping: write deny -> readOnly sandbox', () => {
  const g = grant({ write_project: 'deny' });
  const s = grantToSandbox(g, '/ws');
  assert.equal(s.sandboxPolicy.type, 'readOnly');
  assert.equal(s.approvalPolicy, 'on-request');
});

test('codex sandbox mapping: network ask -> networkAccess false (approval chain decides)', () => {
  const g = grant({ network: 'ask' });
  const s = grantToSandbox(g, '/ws');
  assert.equal(s.sandboxPolicy.networkAccess, false);
  assert.equal(s.networkMode, 'allow');
});
