'use strict';

const WORKER_TYPES = {
  FAKE: 'fake-worker',
  OPENCODE: 'opencode',
  CODEX: 'codex',
};

function agentWorkerContract() {
  return {
    startTask: '({project, task, grant, execution}) -> session handle（启动/复用 worker 会话，发送任务）',
    getStatus: '(executionId) -> QUEUED|RUNNING|WAITING_FOR_USER|WAITING_FOR_APPROVAL|RESULT_AVAILABLE|FAILED|CANCELLED',
    subscribeEvents: '(executionId) -> event stream（状态/审批/提问/输出增量）',
    respondToApproval: '(executionId, approvalId, decision) -> void',
    respondToQuestion: '(executionId, questionId, answer) -> void',
    sendFollowup: '(executionId, text) -> void',
    cancel: '(executionId) -> void',
    getResult: '(executionId) -> {summary, diff, tests, artifacts, evidence}',
  };
}

function registerWorkers(config) {
  const workers = {};
  const entries = Object.entries(config || {});
  for (const [name, def] of entries) {
    workers[name] = Object.assign({ name }, def);
  }
  return workers;
}

module.exports = { WORKER_TYPES, agentWorkerContract, registerWorkers };
