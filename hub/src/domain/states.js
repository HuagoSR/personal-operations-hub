'use strict';

const TASK_STATES = ['OPEN', 'EXECUTING', 'RESULT_AVAILABLE', 'REVIEW', 'COMPLETED', 'CANCELLED'];

const EXECUTION_STATES = ['QUEUED', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL', 'RESULT_AVAILABLE', 'FAILED', 'CANCELLED'];

const CANDIDATE_STATES = ['OPEN', 'CONVERTED', 'REJECTED', 'EXPIRED', 'CANCELLED'];

const APPROVAL_STATES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'];

const GRANT_STATES = ['ACTIVE', 'REVOKED'];

const INBOX_STATES = ['NEW', 'READ', 'IGNORED', 'ARCHIVED', 'CONVERTED'];

const QUESTION_STATES = ['OPEN', 'ANSWERED', 'EXPIRED'];

const PERMISSION_STATES = ['OPEN', 'ALLOWED', 'DENIED', 'ASKED_USER', 'EXPIRED'];

const OUTBOX_STATES = ['PENDING', 'DISPATCHED', 'FAILED', 'DEAD'];

const TASK_TRANSITIONS = {
  OPEN: ['EXECUTING', 'CANCELLED'],
  EXECUTING: ['RESULT_AVAILABLE', 'CANCELLED'],
  RESULT_AVAILABLE: ['REVIEW', 'CANCELLED'],
  REVIEW: ['COMPLETED', 'EXECUTING', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const EXECUTION_TRANSITIONS = {
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['WAITING_FOR_USER', 'WAITING_FOR_APPROVAL', 'RESULT_AVAILABLE', 'FAILED', 'QUEUED', 'CANCELLED'],
  WAITING_FOR_USER: ['RUNNING', 'FAILED', 'CANCELLED'],
  WAITING_FOR_APPROVAL: ['RUNNING', 'FAILED', 'CANCELLED'],
  RESULT_AVAILABLE: [],
  FAILED: [],
  CANCELLED: [],
};

const CANDIDATE_TRANSITIONS = {
  OPEN: ['CONVERTED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  CONVERTED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

const APPROVAL_TRANSITIONS = {
  PENDING: ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

const GRANT_TRANSITIONS = {
  ACTIVE: ['REVOKED'],
  REVOKED: [],
};

const INBOX_TRANSITIONS = {
  NEW: ['READ', 'IGNORED', 'ARCHIVED', 'CONVERTED'],
  READ: ['IGNORED', 'ARCHIVED', 'CONVERTED'],
  IGNORED: ['ARCHIVED'],
  ARCHIVED: [],
  CONVERTED: [],
};

const SCENARIOS = ['SUCCESS', 'FAIL', 'WAIT_FOR_USER', 'WAIT_FOR_APPROVAL', 'TIMEOUT', 'CRASH_ONCE_THEN_SUCCESS'];

const CAPABILITIES = [
  'read_project',
  'write_project',
  'run_project_commands',
  'run_tests',
  'install_dependencies',
  'network',
  'git_commit',
  'git_push',
  'sudo',
  'system_config',
  'outside_project',
];

const CAPABILITY_VALUES = ['allow', 'ask', 'deny'];

const HIGH_RISK_CAPABILITIES = new Set(['sudo', 'system_config', 'git_push', 'outside_project']);

const DEFAULT_CAPABILITIES = Object.freeze({
  read_project: 'allow',
  write_project: 'allow',
  run_project_commands: 'allow',
  run_tests: 'allow',
  install_dependencies: 'ask',
  network: 'ask',
  git_commit: 'allow',
  git_push: 'ask',
  sudo: 'deny',
  system_config: 'deny',
  outside_project: 'ask',
});

const SELF_PROJECT_TEMPLATE = Object.freeze({
  read_project: 'allow',
  write_project: 'allow',
  run_project_commands: 'allow',
  run_tests: 'allow',
  install_dependencies: 'allow',
  network: 'ask',
  git_commit: 'allow',
  git_push: 'ask',
  sudo: 'deny',
  system_config: 'deny',
  outside_project: 'deny',
});

const CAPABILITY_RANK = { deny: 0, ask: 1, allow: 2 };

module.exports = {
  TASK_STATES,
  EXECUTION_STATES,
  CANDIDATE_STATES,
  APPROVAL_STATES,
  GRANT_STATES,
  INBOX_STATES,
  QUESTION_STATES,
  PERMISSION_STATES,
  OUTBOX_STATES,
  TASK_TRANSITIONS,
  EXECUTION_TRANSITIONS,
  CANDIDATE_TRANSITIONS,
  APPROVAL_TRANSITIONS,
  GRANT_TRANSITIONS,
  INBOX_TRANSITIONS,
  SCENARIOS,
  CAPABILITIES,
  CAPABILITY_VALUES,
  HIGH_RISK_CAPABILITIES,
  DEFAULT_CAPABILITIES,
  SELF_PROJECT_TEMPLATE,
  CAPABILITY_RANK,
};
