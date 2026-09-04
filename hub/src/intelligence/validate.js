'use strict';
const {
  LEVELS, INTENTS, REASON_CODES, RISK_FLAGS, CLAIM_TYPES, LIMITS,
} = require('./schema');

// Strict validation chain: parse -> schema -> enum -> length -> whitelist.
// Invalid output must be marked FAILED, never guessed.

const ALLOWED_KEYS = new Set([
  'summary', 'importance', 'urgency', 'requires_action', 'intent', 'deadline',
  'suggested_project', 'suggested_task', 'reason_codes', 'evidence_refs', 'risk_flags', 'confidence',
]);

function isEnum(v, list) {
  return typeof v === 'string' && list.includes(v);
}

function validateAnalysisOutput(rawText) {
  let obj;
  try {
    obj = JSON.parse(rawText);
  } catch (e) {
    return { ok: false, error: 'invalid JSON' };
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'output must be a JSON object' };
  }
  const out = {};
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    out[key] = obj[key];
  }
  const err = (msg) => ({ ok: false, error: msg });

  if (typeof out.summary !== 'string' || !out.summary.trim()) return err('summary required');
  out.summary = out.summary.trim().slice(0, LIMITS.summary);

  if (!isEnum(out.importance, LEVELS)) return err('importance must be HIGH|MEDIUM|LOW');
  if (!isEnum(out.urgency, LEVELS)) return err('urgency must be HIGH|MEDIUM|LOW');
  if (typeof out.requires_action !== 'boolean') return err('requires_action must be boolean');
  if (!isEnum(out.intent, INTENTS)) return err('invalid intent');

  if (out.deadline === undefined || out.deadline === null) out.deadline = { text: null, resolved: null };
  else {
    if (typeof out.deadline !== 'object' || Array.isArray(out.deadline)) return err('deadline must be object');
    const text = out.deadline.text;
    if (text !== null && text !== undefined && typeof text !== 'string') return err('deadline.text must be string|null');
    const resolved = out.deadline.resolved;
    if (resolved !== null && resolved !== undefined && typeof resolved !== 'string') return err('deadline.resolved must be string|null');
    out.deadline = {
      text: text ? String(text).slice(0, LIMITS.deadline_text) : null,
      resolved: resolved || null,
    };
  }

  if (out.suggested_project === undefined || out.suggested_project === null) {
    out.suggested_project = { project_id: null, confidence: null };
  } else {
    if (typeof out.suggested_project !== 'object') return err('suggested_project must be object');
    const pid = out.suggested_project.project_id;
    if (pid !== null && pid !== undefined && !Number.isInteger(pid)) return err('suggested_project.project_id must be integer|null');
    out.suggested_project = { project_id: pid === undefined ? null : pid, confidence: numOrNull(out.suggested_project.confidence) };
  }

  if (out.suggested_task === undefined || out.suggested_task === null) {
    out.suggested_task = { title: null, description: null, confidence: null };
  } else {
    if (typeof out.suggested_task !== 'object') return err('suggested_task must be object');
    const title = out.suggested_task.title;
    if (title !== null && title !== undefined && (typeof title !== 'string' || !title.trim())) {
      return err('suggested_task.title invalid');
    }
    out.suggested_task = {
      title: title ? String(title).trim().slice(0, LIMITS.suggested_task_title) : null,
      description: out.suggested_task.description ? String(out.suggested_task.description).slice(0, LIMITS.suggested_task_description) : null,
      confidence: numOrNull(out.suggested_task.confidence),
    };
    if (!out.requires_action && out.suggested_task.title) {
      return err('suggested_task requires requires_action=true');
    }
  }

  if (!Array.isArray(out.reason_codes)) return err('reason_codes must be array');
  for (const c of out.reason_codes) {
    if (!REASON_CODES.includes(c)) return err(`invalid reason_code ${c}`);
  }
  out.reason_codes = out.reason_codes.slice(0, LIMITS.reason_codes);

  if (!Array.isArray(out.evidence_refs)) return err('evidence_refs must be array');
  for (const ref of out.evidence_refs) {
    if (ref === null || typeof ref !== 'object') return err('evidence_ref must be object');
    if (!Number.isInteger(ref.episode_message_index) || ref.episode_message_index < 1) {
      return err('evidence_ref.episode_message_index must be positive integer');
    }
    if (!CLAIM_TYPES.includes(ref.claim_type)) return err('invalid evidence_ref.claim_type');
  }
  out.evidence_refs = out.evidence_refs.slice(0, LIMITS.evidence_refs);

  if (!Array.isArray(out.risk_flags)) return err('risk_flags must be array');
  for (const f of out.risk_flags) {
    if (!RISK_FLAGS.includes(f)) return err(`invalid risk_flag ${f}`);
  }
  out.risk_flags = out.risk_flags.slice(0, LIMITS.risk_flags);

  if (typeof out.confidence !== 'number' || out.confidence < 0 || out.confidence > 1) {
    return err('confidence must be number 0-1');
  }
  return { ok: true, value: out };
}

function numOrNull(v) {
  if (typeof v === 'number' && v >= 0 && v <= 1) return v;
  return null;
}

module.exports = { validateAnalysisOutput };
