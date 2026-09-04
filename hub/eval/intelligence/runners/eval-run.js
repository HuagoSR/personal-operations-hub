#!/usr/bin/env node
'use strict';
// Eval runner: corpus -> model client -> validate -> save raw results to runs/<ts>/results.json
// Usage: node eval/intelligence/runners/eval-run.js [--provider stub|deepseek] [--corpus path]
const fs = require('fs');
const path = require('path');
const { createClient } = require('../../../src/intelligence/client');
const { buildMessages } = require('../../../src/intelligence/prompt');
const { validateAnalysisOutput } = require('../../../src/intelligence/validate');
const { ANALYSIS_SCHEMA_VERSION } = require('../../../src/intelligence/schema');

const ROOT = path.join(__dirname, '..');
const argAfter = (flag, fallback) => {
  const idx = process.argv.indexOf(flag);
  return idx > -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
};
const corpusPath = argAfter('--corpus', path.join(ROOT, 'corpus', 'v1-cases.json'));
const provider = argAfter('--provider', 'stub');
const cfg = {
  intelligenceProvider: provider,
  intelligenceModel: 'deepseek-chat',
  intelligenceApiBase: 'https://api.deepseek.com',
  intelligenceApiKeyEnv: 'HUB_INTELLIGENCE_API_KEY',
};

function caseToContext(c) {
  let mentioned = false;
  const messages = c.episode.map((m, i) => {
    if (m.is_mentioned) mentioned = true;
    return { i: i + 1, minutes: i * 1, sender: m.sender, text: m.text };
  });
  return { chat_type: c.chat_type, chat_label: 'chat_x', mentioned, messages, projects: c.projects || [], related_tasks: [] };
}

async function main() {
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const client = createClient(cfg);
  const outDir = path.join(ROOT, 'runs', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const c of corpus.cases) {
    const context = caseToContext(c);
    const modelMessages = buildMessages(context);
    const raw = await client.analyze({ messages: modelMessages, model: cfg.intelligenceModel });
    let validated = null;
    let validationError = null;
    if (raw.ok) {
      const v = validateAnalysisOutput(raw.output);
      validated = v.ok ? v.value : null;
      validationError = v.ok ? null : v.error;
    }
    results.push({
      id: c.id,
      scenario: c.scenario,
      chat_type: c.chat_type,
      expected: c.expected,
      provider: client.provider,
      schema_version: ANALYSIS_SCHEMA_VERSION,
      raw_ok: raw.ok,
      provider_error: raw.ok ? null : raw.error,
      validation_error: validationError,
      validated,
    });
    console.log(`${c.id}: raw=${raw.ok ? 'ok' : 'FAIL'} validate=${validated ? 'ok' : validationError || 'no-output'}`);
  }
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\nwrote ${results.length} results to ${path.relative(ROOT, outDir)}/results.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
