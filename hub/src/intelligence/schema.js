'use strict';

const ANALYSIS_SCHEMA_VERSION = '1';

const LEVELS = ['HIGH', 'MEDIUM', 'LOW'];
const INTENTS = ['REQUEST', 'INFORMATION', 'QUESTION', 'TASK_UPDATE', 'CANCELLATION', 'SOCIAL', 'OTHER'];
const REASON_CODES = [
  'EXPLICIT_REQUEST', 'IMPLICIT_REQUEST', 'EXPLICIT_DEADLINE', 'MENTIONED_USER',
  'REPEATED_URGING', 'TASK_UPDATE', 'CANCELLATION', 'SCHEDULING', 'DELIVERY_NEEDED',
  'HIGH_VALUE_TOPIC', 'INJECTION_SUSPECTED', 'NOISE', 'CANNOT_DETERMINE',
];
const RISK_FLAGS = [
  'PROMPT_INJECTION_SUSPECTED', 'CREDENTIAL_REQUEST', 'HARMFUL_REQUEST',
  'PRIVATE_DATA_REQUEST', 'PHISHING_SUSPECTED',
];
const CLAIM_TYPES = ['deadline', 'request', 'urgency', 'task_context', 'cancellation', 'noise'];

const LIMITS = {
  summary: 200,
  suggested_task_title: 100,
  suggested_task_description: 400,
  evidence_refs: 20,
  reason_codes: 20,
  risk_flags: 10,
  deadline_text: 100,
};

const SCHEMA_JSON = `{
  "summary": "string ≤200",
  "importance": "HIGH|MEDIUM|LOW",
  "urgency": "HIGH|MEDIUM|LOW",
  "requires_action": "boolean",
  "intent": "REQUEST|INFORMATION|QUESTION|TASK_UPDATE|CANCELLATION|SOCIAL|OTHER",
  "deadline": { "text": "string|null 原样摘录", "resolved": "ISO8601|null 仅明确日期时" },
  "suggested_project": { "project_id": "integer|null 仅从清单选", "confidence": "0-1|null" },
  "suggested_task": { "title": "string ≤100|null", "description": "string ≤400|null", "confidence": "0-1|null" },
  "reason_codes": ["EXPLICIT_REQUEST|IMPLICIT_REQUEST|EXPLICIT_DEADLINE|MENTIONED_USER|REPEATED_URGING|TASK_UPDATE|CANCELLATION|SCHEDULING|DELIVERY_NEEDED|HIGH_VALUE_TOPIC|INJECTION_SUSPECTED|NOISE|CANNOT_DETERMINE"],
  "evidence_refs": [{ "episode_message_index": "integer ≥1", "claim_type": "deadline|request|urgency|task_context|cancellation|noise" }],
  "risk_flags": ["PROMPT_INJECTION_SUSPECTED|CREDENTIAL_REQUEST|HARMFUL_REQUEST|PRIVATE_DATA_REQUEST|PHISHING_SUSPECTED"],
  "confidence": "number 0-1"
}`;

module.exports = {
  ANALYSIS_SCHEMA_VERSION,
  LEVELS,
  INTENTS,
  REASON_CODES,
  RISK_FLAGS,
  CLAIM_TYPES,
  LIMITS,
  SCHEMA_JSON,
};
