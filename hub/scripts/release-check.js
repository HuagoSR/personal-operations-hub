#!/usr/bin/env node
'use strict';
// release-check.js — Release verification asset (R0-B).
// Scans the repo working tree for portability violations and secrets.
// Exit 0 = clean; Exit 1 = violations found.
// Usage: node scripts/release-check.js [repoRoot]
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'vendor', 'runs']);
const EXCLUDE_FILES = new Set(['release-check.js']);

// Patterns that must not appear in shipped code.
// docs/manuals may reference example paths (they carry their own disclaimer).
const PORTABILITY_PATTERNS = [
  { re: /\/home\/[a-z0-9_-]+/i, label: 'specific-user-home' },
  { re: /wechat-linux-research/, label: 'legacy-project-root' },
  { re: /\/usr\/bin\/codex/, label: 'hardcoded-codex' },
];

// allowlist: files allowed to contain the above (docs/manuals + compat defaults)
function portabilityAllowed(rel) {
  if (rel.startsWith('docs/manuals/')) return true; // example deployment paths, documented
  if (rel.startsWith('docs/')) return true;
  if (rel.startsWith('hub/tests/')) return true; // test fixtures/pattern literals, no real secrets
  if (rel === 'deploy/docker-compose.yml') return true; // compat default container name
  if (rel === 'hub/scripts/deploy.ps1') return true; // dev helper legacy default
  return false;
}

const SECRET_PATTERNS = [
  { re: /wxid_[a-z0-9]{12,}/, label: 'wxid' },
  { re: /sk-[A-Za-z0-9]{16,}/, label: 'api-key' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private-key' },
  { re: /HUB_INTELLIGENCE_API_KEY=[A-Za-z0-9]/, label: 'api-key-value' },
];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    if (e.name === 'config.json') continue; // site-local, not shipped
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const files = walk(ROOT, []);
const violations = [];
let scanned = 0;
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  if (EXCLUDE_FILES.has(path.basename(f))) continue;
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  scanned++;
  if (!rel.startsWith('hub/tests/')) {
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(text)) violations.push(`${rel}: SECRET ${p.label}`);
    }
  }
  if (!portabilityAllowed(rel)) {
    for (const p of PORTABILITY_PATTERNS) {
      const m = text.match(p.re);
      if (m) violations.push(`${rel}: portability ${p.label} (${m[0]})`);
    }
  }
}

if (violations.length) {
  console.error(`release-check FAILED (${violations.length} violations, ${scanned} files scanned):`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`release-check PASS: ${scanned} files scanned, no secrets, no portability violations`);
process.exit(0);
