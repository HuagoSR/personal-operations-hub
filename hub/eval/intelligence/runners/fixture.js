#!/usr/bin/env node
'use strict';
// Fixture run: synthesize model outputs from corpus "expected" labels (valid schema).
// Purpose: validate scorer + corpus label consistency before any real model is used (7B).
// Usage: node eval/intelligence/runners/fixture.js
const fs = require('fs');
const path = require('path');
const { validateAnalysisOutput } = require('../../../src/intelligence/validate');

const ROOT = path.join(__dirname, '..');
const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, 'corpus', 'v1-cases.json'), 'utf8'));
const outDir = path.join(ROOT, 'runs', `fixture-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
fs.mkdirSync(outDir, { recursive: true });

function toOutput(c) {
  const e = c.expected;
  const output = {
    summary: `fixture for ${c.id}`,
    importance: e.importance || (e.requires_action ? 'MEDIUM' : 'LOW'),
    urgency: e.urgency || (e.requires_action ? 'MEDIUM' : 'LOW'),
    requires_action: e.requires_action === true,
    intent: e.intent || 'OTHER',
    deadline: { text: e.deadline ? 'deadline fixture' : null, resolved: null },
    suggested_project: { project_id: e.project_id !== undefined ? e.project_id : null, confidence: e.project_id !== undefined ? 0.9 : null },
    suggested_task: e.requires_action
      ? { title: 'fixture task', description: 'fixture', confidence: 0.85 }
      : { title: null, description: null, confidence: null },
    reason_codes: e.requires_action ? ['EXPLICIT_REQUEST'] : ['NOISE'],
    evidence_refs: [],
    risk_flags: e.risk_flags || [],
    confidence: e.confidence_low ? 0.3 : 0.9,
  };
  return output;
}

const results = [];
for (const c of corpus.cases) {
  const out = toOutput(c);
  const v = validateAnalysisOutput(JSON.stringify(out));
  results.push({
    id: c.id, scenario: c.scenario, chat_type: c.chat_type, expected: c.expected,
    provider: 'fixture', raw_ok: true, validation_error: null, validated: v.value,
  });
}
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
console.log(`fixture run written to ${path.relative(ROOT, outDir)}/results.json`);
console.log('run: node eval/intelligence/runners/score.js ' + path.relative(ROOT, outDir));
