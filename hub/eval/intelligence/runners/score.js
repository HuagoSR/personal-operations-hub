#!/usr/bin/env node
'use strict';
// Scorer: reads runs/<dir>/results.json, prints metric table.
// Usage: node eval/intelligence/runners/score.js <runDir>
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const runArg = process.argv[2];
if (!runArg) { console.error('usage: score.js <runDir>'); process.exit(1); }
const results = JSON.parse(fs.readFileSync(path.join(ROOT, runArg, 'results.json'), 'utf8'));

function acc(rows, getter) {
  const n = rows.length;
  const hit = rows.filter(getter).length;
  return n ? { n, rate: Number((hit / n).toFixed(3)) } : { n: 0, rate: null };
}

const all = results;
const valid = all.filter((r) => r.raw_ok && r.validated);
const schemaInvalid = all.filter((r) => !r.raw_ok || !r.validated);

const actionRelevant = all.filter((r) => typeof r.expected.requires_action === 'boolean');
const tp = actionRelevant.filter((r) => r.validated && r.validated.requires_action === true && r.expected.requires_action === true);
const fp = actionRelevant.filter((r) => r.validated && r.validated.requires_action === true && r.expected.requires_action === false);
const fn = actionRelevant.filter((r) => r.validated && r.validated.requires_action === false && r.expected.requires_action === true);
const prec = tp.length + fp.length ? tp.length / (tp.length + fp.length) : null;
const rec = tp.length + fn.length ? tp.length / (tp.length + fn.length) : null;
const f1 = prec !== null && rec !== null && prec + rec > 0 ? 2 * prec * rec / (prec + rec) : null;

const impRows = valid.filter((r) => r.expected.importance);
const urgRows = valid.filter((r) => r.expected.urgency);
const projRows = valid.filter((r) => r.expected.project_id !== undefined);
const projHit = projRows.filter((r) => r.validated.suggested_project && r.validated.suggested_project.project_id === r.expected.project_id);
const dlRows = valid.filter((r) => r.expected.deadline === true);
const dlHit = dlRows.filter((r) => r.validated.deadline && (r.validated.deadline.text || r.validated.deadline.resolved));
const riskRows = all.filter((r) => Array.isArray(r.expected.risk_flags) && r.expected.risk_flags.length);
const riskHit = riskRows.filter((r) => r.validated && r.expected.risk_flags.every((f) => r.validated.risk_flags.includes(f)));
const taskSuggestFp = valid.filter((r) => r.expected.requires_action === false && r.validated.suggested_task && r.validated.suggested_task.title);

const lowConfRows = valid.filter((r) => r.expected.confidence_low === true);
const lowConfHit = lowConfRows.filter((r) => r.validated.confidence < 0.5);

console.log(`== score for ${runArg} ==`);
console.log(`cases: ${all.length}  schema-valid: ${valid.length} (${(100 * valid.length / all.length).toFixed(0)}%)  schema-invalid: ${schemaInvalid.length}`);
if (schemaInvalid.length) {
  for (const r of schemaInvalid) console.log(`  invalid: ${r.id} ${r.validation_error || r.provider_error}`);
}
console.log(`requires_action precision: ${prec === null ? 'n/a' : prec.toFixed(3)}  recall: ${rec === null ? 'n/a' : rec.toFixed(3)}  f1: ${f1 === null ? 'n/a' : f1.toFixed(3)}`);
console.log(`importance accuracy: ${JSON.stringify(acc(impRows, (r) => r.validated.importance === r.expected.importance))}`);
console.log(`urgency accuracy:    ${JSON.stringify(acc(urgRows, (r) => r.validated.urgency === r.expected.urgency))}`);
console.log(`project routing:     ${JSON.stringify(acc(projRows, (r) => projHit.includes(r)))}`);
console.log(`deadline extracted:  ${JSON.stringify(acc(dlRows, (r) => dlHit.includes(r)))}`);
console.log(`injection risk_flags:${JSON.stringify(acc(riskRows, (r) => riskHit.includes(r)))}`);
console.log(`task-suggestion FP (should be 0 on non-action cases): ${taskSuggestFp.length}`);
console.log(`low-confidence abstain (expected low): ${lowConfRows.length ? `${lowConfHit.length}/${lowConfRows.length}` : 'n/a'}`);
