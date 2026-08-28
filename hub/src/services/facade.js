'use strict';
const { tx } = require('./tx');
const { applyTransition } = require('./state-machine');
const { appendDomainEvent } = require('./audit');
const { INBOX_TRANSITIONS, SCENARIOS, CAPABILITIES, CAPABILITY_VALUES } = require('../domain/states');
const { BadRequestError, NotFoundError } = require('../domain/errors');
const { findInboxItem, listInboxItems } = require('../domain/inbox-item');
const { findEvent, rawMessagesOfEvent } = require('../domain/event');
const { findCandidate, listCandidates } = require('../domain/task-candidate');
const { findApproval, listApprovals } = require('../domain/approval');
const { findTask, listTasks, executionsOfTask, resultsOfTask } = require('../domain/task');
const { findGrant, listGrants } = require('../domain/execution-grant');
const { findExecution, listExecutions } = require('../domain/execution');
const { findResult, listResults, findResultByExecution } = require('../domain/result');
const { listProjects, findProject, insertProject, findProjectByName } = require('../domain/project');
const {
  listConversations, findConversation, insertConversation,
  findOrCreateGlobalConversation, insertMessage, listMessages,
} = require('../domain/conversation');
const { listQuestions } = require('../domain/execution-question');
const { listPermissionRequests } = require('../domain/permission-request');
const { listByEntity, listAll } = require('../domain/transition-log');
const domainEventRepo = require('../domain/domain-event');
const { listOutbox } = require('../domain/outbox-event');
const { createUserCommand: userCommandCreate } = require('./user-command-service');
const {
  createCandidateFromInbox, rejectCandidate, approveCandidate,
} = require('./candidate-service');
const { requestAnotherExecution, cancelTask, answerQuestion, decidePermissionRequest } = require('./execution-service');
const { revokeGrant } = require('./grant-admin');
const { completeReview } = require('./review-service');

const USER_ACTOR = { actorType: 'USER', actorId: 'owner' };

function count(db, sql, ...args) {
  return db.prepare(sql).get(...args).c;
}

function createServiceFacade(db, ctx) {
  return {
    status() {
      return {
        ok: true,
        version: '0.1.0',
        time: new Date().toISOString(),
        workers: ['fake-worker'],
        capabilities: CAPABILITIES,
        scenarios: SCENARIOS,
        capabilityValues: CAPABILITY_VALUES,
      };
    },

    dashboard() {
      return {
        inbox: count(db, "SELECT COUNT(*) AS c FROM inbox_items WHERE state = 'NEW'"),
        candidates: count(db, "SELECT COUNT(*) AS c FROM task_candidates WHERE state = 'OPEN'"),
        pendingApprovals: count(db, "SELECT COUNT(*) AS c FROM approvals WHERE state = 'PENDING'"),
        runningExecutions: count(db, "SELECT COUNT(*) AS c FROM executions WHERE state IN ('RUNNING','QUEUED')"),
        waitingForUser: count(db, "SELECT COUNT(*) AS c FROM executions WHERE state IN ('WAITING_FOR_USER','WAITING_FOR_APPROVAL')"),
        resultsAvailable: count(db, "SELECT COUNT(*) AS c FROM tasks WHERE state IN ('RESULT_AVAILABLE','REVIEW')"),
        completedTasks: count(db, "SELECT COUNT(*) AS c FROM tasks WHERE state = 'COMPLETED'"),
        projects: listProjects(db),
        outboxPending: count(db, "SELECT COUNT(*) AS c FROM outbox_events WHERE state IN ('PENDING','FAILED')"),
        outboxDead: count(db, "SELECT COUNT(*) AS c FROM outbox_events WHERE state = 'DEAD'"),
      };
    },

    inboxList(state) {
      return listInboxItems(db, { state: state || undefined });
    },

    inboxDetail(id) {
      const item = findInboxItem(db, id);
      if (!item) throw new NotFoundError('inbox', id);
      const ev = findEvent(db, item.event_id);
      const raw = ev ? rawMessagesOfEvent(db, ev.id) : [];
      const candidate = db.prepare('SELECT * FROM task_candidates WHERE source_event_id = ?').get(ev ? ev.id : -1);
      return { item, event: ev, rawMessages: raw, candidate: candidate || null };
    },

    inboxAction(id, action, body) {
      const item = findInboxItem(db, id);
      if (!item) throw new NotFoundError('inbox', id);
      if (action === 'convert') {
        return createCandidateFromInbox(db, {
          inboxId: id,
          title: body.title || null,
          description: body.description || null,
          projectId: body.projectId || null,
          actor: USER_ACTOR,
          ttlMs: body.ttlMs ? Number(body.ttlMs) : ctx.cfg.approvalDefaultTtlMs,
        });
      }
      const target = { read: 'READ', ignore: 'IGNORED', archive: 'ARCHIVED' }[action];
      if (!target) throw new BadRequestError(`unknown inbox action ${action}`);
      return tx(db, () => {
        applyTransition(db, {
          table: 'inbox_items', entityType: 'inbox', id, from: item.state, to: target,
          transitions: INBOX_TRANSITIONS, version: item.version, actor: USER_ACTOR,
          reason: `inbox ${action}`,
        });
        return findInboxItem(db, id);
      });
    },

    createUserCommand(body) {
      return userCommandCreate(db, {
        text: body.text,
        projectId: body.projectId || null,
        actor: USER_ACTOR,
        ttlMs: ctx.cfg.approvalDefaultTtlMs,
      });
    },

    candidateList(state) {
      return listCandidates(db, { state: state || undefined });
    },

    candidateDetail(id) {
      const c = findCandidate(db, id);
      if (!c) throw new NotFoundError('candidate', id);
      const approvals = db.prepare('SELECT * FROM approvals WHERE candidate_id = ? ORDER BY id DESC').all(id);
      return { candidate: c, approvals };
    },

    candidateDecision(id, action, body) {
      if (action === 'reject') {
        return rejectCandidate(db, { candidateId: id, actor: USER_ACTOR, reason: body.reason });
      }
      const capabilities = {};
      if (body.grant && typeof body.grant === 'object') {
        for (const [k, v] of Object.entries(body.grant)) {
          if (CAPABILITIES.includes(k) && CAPABILITY_VALUES.includes(v)) capabilities[k] = v;
        }
      }
      const scenario = body.scenario || 'SUCCESS';
      return approveCandidate(db, {
        candidateId: id,
        actor: USER_ACTOR,
        title: body.title || null,
        description: body.description || null,
        projectId: body.projectId || null,
        capabilities,
        scenario,
        worker: body.worker || 'fake-worker',
        timeoutMs: body.timeoutMs ? Number(body.timeoutMs) : undefined,
        cfg: ctx.cfg,
      });
    },

    approvalList(state) {
      return listApprovals(db, { state: state || undefined });
    },

    taskList(state) {
      return listTasks(db, { state: state || undefined });
    },

    taskDetail(id) {
      const task = findTask(db, id);
      if (!task) throw new NotFoundError('task', id);
      const executions = executionsOfTask(db, id).map((ex) => ({
        ...ex,
        questions: listQuestions(db, ex.id),
        permissions: listPermissionRequests(db, ex.id),
        result: findResultByExecution(db, ex.id),
      }));
      const grants = listGrants(db, { taskId: id });
      const candidate = task.candidate_id ? findCandidate(db, task.candidate_id) : null;
      return { task, candidate, executions, results: resultsOfTask(db, id), grants };
    },

    cancelTask(id, body) {
      const r = cancelTask(db, { taskId: id, actor: USER_ACTOR, reason: body.reason });
      const rt = ctx.workerRuntime;
      if (rt) {
        const { listExecutions } = require('../domain/execution');
        for (const ex of listExecutions(db, { taskId: id })) {
          rt.cancelWorker(db, ctx, ex).catch(() => {});
        }
      }
      return r;
    },

    requestAnotherExecution(id, body) {
      return requestAnotherExecution(db, {
        taskId: id,
        scenario: body.scenario || 'SUCCESS',
        timeoutMs: body.timeoutMs ? Number(body.timeoutMs) : undefined,
        actor: USER_ACTOR,
        grantId: body.grantId || null,
        cfg: ctx.cfg,
      });
    },

    grantList(taskId) {
      return listGrants(db, { taskId: taskId ? Number(taskId) : undefined });
    },

    revokeGrant(id, body) {
      return revokeGrant(db, { grantId: id, actor: USER_ACTOR, reason: body.reason });
    },

    executionList(state) {
      return listExecutions(db, { state: state || undefined });
    },

    executionDetail(id) {
      const ex = findExecution(db, id);
      if (!ex) throw new NotFoundError('execution', id);
      return {
        execution: ex,
        questions: listQuestions(db, id),
        permissions: listPermissionRequests(db, id),
        result: findResultByExecution(db, id),
        grant: ex.grant_id ? findGrant(db, ex.grant_id) : null,
      };
    },

    answerQuestion(id, qid, body) {
      const r = answerQuestion(db, {
        executionId: id, questionId: qid, answer: body.answer || '', actor: USER_ACTOR,
      });
      const rt = ctx.workerRuntime;
      if (rt) {
        rt.forwardAnswer(ctx, id, body.answer || '').catch(() => {});
      }
      return r;
    },

    decidePermission(id, pid, body) {
      const r = decidePermissionRequest(db, {
        executionId: id, permissionId: pid, decision: body.decision, actor: USER_ACTOR,
      });
      const rt = ctx.workerRuntime;
      if (rt && r && r.ok !== false && body.decision) {
        rt.forwardDecision(ctx, id, body.decision).catch(() => {});
      }
      return r;
    },

    resultList(taskId) {
      return listResults(db, { taskId: taskId ? Number(taskId) : undefined });
    },

    resultDetail(id) {
      const result = findResult(db, id);
      if (!result) throw new NotFoundError('result', id);
      const task = findTask(db, result.task_id);
      const execution = findExecution(db, result.execution_id);
      return { result, task, execution };
    },

    reviewResult(id, body) {
      const action = body.action || 'complete';
      if (action === 'complete') {
        return completeReview(db, { resultId: id, actor: USER_ACTOR });
      }
      if (action === 'another_execution') {
        const result = findResult(db, id);
        if (!result) throw new NotFoundError('result', id);
        return requestAnotherExecution(db, {
          taskId: result.task_id,
          scenario: body.scenario || 'SUCCESS',
          timeoutMs: body.timeoutMs ? Number(body.timeoutMs) : undefined,
          actor: USER_ACTOR,
          grantId: body.grantId || null,
          cfg: ctx.cfg,
        });
      }
      throw new BadRequestError(`unknown review action ${action}`);
    },

    projectList() {
      return listProjects(db);
    },

    projectDetail(id) {
      const project = findProject(db, id);
      if (!project) throw new NotFoundError('project', id);
      return {
        project,
        conversations: listConversations(db, { projectId: id }),
        tasks: listTasks(db, { projectId: id }),
        events: db.prepare('SELECT * FROM events WHERE project_id = ? ORDER BY id DESC LIMIT 200').all(id),
        results: db.prepare('SELECT r.* FROM results r JOIN tasks t ON t.id = r.task_id WHERE t.project_id = ? ORDER BY r.id DESC LIMIT 100').all(id),
      };
    },

    createProject(body) {
      if (!body.name || !String(body.name).trim()) throw new BadRequestError('project name required');
      if (findProjectByName(db, String(body.name).trim())) throw new BadRequestError('project name already exists');
      const id = insertProject(db, {
        name: String(body.name).trim(),
        description: body.description || null,
        workspacePath: body.workspacePath || null,
      });
      return findProject(db, id);
    },

    conversationList(projectId) {
      return listConversations(db, { projectId: projectId ? Number(projectId) : undefined });
    },

    createConversation(body) {
      const id = insertConversation(db, {
        title: body.title || null,
        projectId: body.projectId || null,
        kind: body.projectId ? 'PROJECT' : 'GLOBAL_HUB',
      });
      return findConversation(db, id);
    },

    conversationMessages(id, afterId) {
      const conv = findConversation(db, id);
      if (!conv) throw new NotFoundError('conversation', id);
      return { conversation: conv, messages: listMessages(db, id, { afterId: afterId ? Number(afterId) : 0 }) };
    },

    postConversationMessage(id, body) {
      const conv = findConversation(db, id);
      if (!conv) throw new NotFoundError('conversation', id);
      if (!body.text || !String(body.text).trim()) throw new BadRequestError('message text required');
      return tx(db, () => {
        const msgId = insertMessage(db, {
          conversationId: id, role: 'USER', kind: 'TEXT', content: String(body.text).trim(),
          actorType: USER_ACTOR.actorType, actorId: USER_ACTOR.actorId,
        });
        return msgId;
      });
    },

    transitionLog(entityType, entityId) {
      if (entityType && entityId) return listByEntity(db, entityType, Number(entityId));
      return listAll(db);
    },

    domainEvents(type) {
      if (type) return domainEventRepo.listByType(db, type);
      return domainEventRepo.listAll(db);
    },

    outboxList(state) {
      return listOutbox(db, { state: state || undefined });
    },
  };
}

module.exports = { createServiceFacade };
