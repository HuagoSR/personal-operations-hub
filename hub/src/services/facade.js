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
const { requestAnotherExecution, cancelTask, answerQuestion, decidePermissionRequest, createFollowupExecution } = require('./execution-service');
const { revokeGrant } = require('./grant-admin');
const { completeReview } = require('./review-service');
const { ensureSystemEntities } = require('./bootstrap');

const USER_ACTOR = { actorType: 'USER', actorId: 'owner' };

function count(db, sql, ...args) {
  return db.prepare(sql).get(...args).c;
}

function assertHealthyText(value, label) {
  const s = String(value || '').trim();
  if (!s) return;
  const q = s.split('?').length - 1;
  const nonSpace = s.replace(/\s/g, '').length;
  if (q >= 8 && q / Math.max(nonSpace, 1) > 0.2) {
    throw new BadRequestError(`${label} 包含大量 '?'，中文可能因客户端编码问题丢失，请使用浏览器重新输入`);
  }
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
      const projects = listProjects(db);
      const projectActivity = [];
      const globalCounts = {};
      for (const r of db.prepare('SELECT state, COUNT(*) AS c FROM tasks WHERE project_id IS NULL GROUP BY state').all()) globalCounts[r.state] = r.c;
      projectActivity.push({ project: null, taskCounts: globalCounts, lastTaskEventAt: null });
      for (const p of projects) {
        const byState = {};
        for (const r of db.prepare('SELECT state, COUNT(*) AS c FROM tasks WHERE project_id = ? GROUP BY state').all(p.id)) byState[r.state] = r.c;
        const last = db.prepare(`SELECT created_at FROM domain_events
          WHERE entity_type = 'task' AND entity_id IN (SELECT id FROM tasks WHERE project_id = ?)
          ORDER BY id DESC LIMIT 1`).get(p.id);
        projectActivity.push({ project: p, taskCounts: byState, lastTaskEventAt: last ? last.created_at : null });
      }
      return {
        inbox: count(db, "SELECT COUNT(*) AS c FROM inbox_items WHERE state = 'NEW'"),
        candidates: count(db, "SELECT COUNT(*) AS c FROM task_candidates WHERE state = 'OPEN'"),
        pendingApprovals: count(db, "SELECT COUNT(*) AS c FROM approvals WHERE state = 'PENDING'"),
        runningExecutions: count(db, "SELECT COUNT(*) AS c FROM executions WHERE state IN ('RUNNING','QUEUED')"),
        waitingForUser: count(db, "SELECT COUNT(*) AS c FROM executions WHERE state IN ('WAITING_FOR_USER','WAITING_FOR_APPROVAL')"),
        resultsAvailable: count(db, "SELECT COUNT(*) AS c FROM tasks WHERE state IN ('RESULT_AVAILABLE','REVIEW')"),
        completedTasks: count(db, "SELECT COUNT(*) AS c FROM tasks WHERE state = 'COMPLETED'"),
        attention: count(db, "SELECT COUNT(*) AS c FROM approvals WHERE state = 'PENDING'")
          + count(db, "SELECT COUNT(*) AS c FROM permission_requests WHERE state = 'OPEN'")
          + count(db, "SELECT COUNT(*) AS c FROM execution_questions WHERE state = 'OPEN'")
          + count(db, "SELECT COUNT(*) AS c FROM apply_requests WHERE state = 'PREPARED'"),
        projects,
        outboxPending: count(db, "SELECT COUNT(*) AS c FROM outbox_events WHERE state IN ('PENDING','FAILED')"),
        outboxDead: count(db, "SELECT COUNT(*) AS c FROM outbox_events WHERE state = 'DEAD'"),
        recentActivity: db.prepare('SELECT id, event_type, entity_type, entity_id, created_at FROM domain_events ORDER BY id DESC LIMIT 15').all(),
        projectActivity,
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
      assertHealthyText(body.text, '命令文本');
      return userCommandCreate(db, {
        text: body.text,
        projectId: body.projectId || null,
        conversationId: body.conversationId ? Number(body.conversationId) : null,
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
      assertHealthyText(body.title, '任务标题');
      assertHealthyText(body.description, '任务描述');
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
        workspace: body.workspace || null,
        cfg: ctx.cfg,
      });
    },

    approvalList(state) {
      return listApprovals(db, { state: state || undefined });
    },

    taskList(state) {
      return listTasks(db, { state: state || undefined });
    },

    taskBuckets() {
      const tasks = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 500').all();
      const latestExecution = (taskId) => db.prepare('SELECT * FROM executions WHERE task_id = ? ORDER BY id DESC LIMIT 1').get(taskId) || null;
      const buckets = { running: [], waitingForMe: [], resultAvailable: [], failed: [], completed: [], cancelled: [] };
      for (const t of tasks) {
        const ex = latestExecution(t.id);
        const entry = { task: t, latestExecution: ex };
        if (t.state === 'COMPLETED') buckets.completed.push(entry);
        else if (t.state === 'CANCELLED') buckets.cancelled.push(entry);
        else if (ex && ex.state === 'FAILED' && !['RESULT_AVAILABLE', 'REVIEW'].includes(t.state)) buckets.failed.push(entry);
        else if (ex && ['WAITING_FOR_USER', 'WAITING_FOR_APPROVAL'].includes(ex.state)) buckets.waitingForMe.push(entry);
        else if (['RESULT_AVAILABLE', 'REVIEW'].includes(t.state)) buckets.resultAvailable.push(entry);
        else buckets.running.push(entry);
      }
      return buckets;
    },

    attentionList() {
      const candidateApprovals = db.prepare(`SELECT a.*, c.title AS candidate_title, c.origin_type, c.description AS candidate_description
        FROM approvals a JOIN task_candidates c ON c.id = a.candidate_id
        WHERE a.state = 'PENDING' ORDER BY a.id DESC LIMIT 200`).all();
      const openPermissions = db.prepare(`SELECT p.*, e.id AS execution_id, e.task_id, e.worker, e.conversation_id,
          t.title AS task_title
        FROM permission_requests p
        JOIN executions e ON e.id = p.execution_id
        JOIN tasks t ON t.id = e.task_id
        WHERE p.state = 'OPEN' ORDER BY p.id DESC LIMIT 200`).all();
      const openQuestions = db.prepare(`SELECT q.*, e.id AS execution_id, e.task_id, e.worker, e.conversation_id,
          t.title AS task_title
        FROM execution_questions q
        JOIN executions e ON e.id = q.execution_id
        JOIN tasks t ON t.id = e.task_id
        WHERE q.state = 'OPEN' ORDER BY q.id DESC LIMIT 200`).all();
      const applyRequests = db.prepare("SELECT * FROM apply_requests WHERE state = 'PREPARED' ORDER BY id DESC LIMIT 50").all();
      return {
        count: candidateApprovals.length + openPermissions.length + openQuestions.length + applyRequests.length,
        candidateApprovals,
        openPermissions,
        openQuestions,
        applyRequests,
      };
    },

    prepareApplyRequest(resultId) {
      const result = findResult(db, resultId);
      if (!result) throw new NotFoundError('result', resultId);
      let facts = {};
      try { facts = result.facts_json ? JSON.parse(result.facts_json) : {}; } catch (e) { }
      if (!facts.commitHash) throw new BadRequestError('result has no commit hash; self-project execution required');
      const task = findTask(db, result.task_id);
      const project = task && task.project_id ? findProject(db, task.project_id) : null;
      if (!project || project.project_type !== 'SYSTEM_HUB') {
        throw new BadRequestError('prepare update is only available for Hub self project results');
      }
      return tx(db, () => {
        const existing = db.prepare("SELECT * FROM apply_requests WHERE result_id = ? AND state = 'PREPARED'").get(resultId);
        if (existing) return existing;
        db.prepare("UPDATE apply_requests SET state = 'SUPERSEDED' WHERE state = 'PREPARED'").run();
        const id = Number(db.prepare(`INSERT INTO apply_requests
          (result_id, task_id, source_commit, base_commit, commit_subject, diff_stat_json, changed_files_json, requires_restart)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
          .run(resultId, result.task_id, facts.commitHash, facts.baseCommit || ctx.cfg.selfDevBaseCommit || null,
            facts.commitSubject || null,
            facts.diffStat ? JSON.stringify(facts.diffStat) : null,
            facts.changedFiles ? JSON.stringify(facts.changedFiles) : null).lastInsertRowid);
        appendDomainEvent(db, {
          eventType: 'APPLY_REQUEST_CREATED', entityType: 'apply_request', entityId: id, actor: USER_ACTOR,
          payload: { resultId, sourceCommit: facts.commitHash },
        });
        return db.prepare('SELECT * FROM apply_requests WHERE id = ?').get(id);
      });
    },

    applyRequestList(state) {
      if (state) return db.prepare('SELECT * FROM apply_requests WHERE state = ? ORDER BY id DESC LIMIT 100').all(state);
      return db.prepare('SELECT * FROM apply_requests ORDER BY id DESC LIMIT 100').all();
    },

    markApplyRequestStatus(id, state, note) {
      if (!['APPLIED', 'FAILED', 'ROLLED_BACK'].includes(state)) {
        throw new BadRequestError(`unknown apply state ${state}`);
      }
      return tx(db, () => {
        const r = db.prepare('SELECT * FROM apply_requests WHERE id = ?').get(id);
        if (!r) throw new NotFoundError('apply_request', id);
        if (r.state !== 'PREPARED') throw new BadRequestError(`apply request is ${r.state}, not PREPARED`);
        db.prepare("UPDATE apply_requests SET state = ?, applied_at = ?, note = ? WHERE id = ? AND state = 'PREPARED'")
          .run(state, new Date().toISOString(), note || null, id);
        appendDomainEvent(db, {
          eventType: 'APPLY_REQUEST_STATUS', entityType: 'apply_request', entityId: id, actor: USER_ACTOR,
          payload: { state, note: note || null },
        });
        return db.prepare('SELECT * FROM apply_requests WHERE id = ?').get(id);
      });
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
      assertHealthyText(body.answer, '回答');
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
      decidePermissionRequest(db, {
        executionId: id, permissionId: pid, decision: body.decision, actor: USER_ACTOR,
      });
      const rt = ctx.workerRuntime;
      if (rt && body.decision) {
        rt.forwardDecision(ctx, id, body.decision).catch(() => {});
      }
      return { ok: true };
    },

    followupExecution(id, body) {
      assertHealthyText(body.text, '跟进指令');
      const parent = findExecution(db, id);
      const rt = ctx.workerRuntime;
      if (rt) {
        rt.cancelWorker(db, ctx, parent).catch(() => {});
      }
      const overrides = {};
      if (body.grant && typeof body.grant === 'object') {
        for (const [k, v] of Object.entries(body.grant)) {
          if (CAPABILITIES.includes(k) && CAPABILITY_VALUES.includes(v)) overrides[k] = v;
        }
      }
      const dspId = createFollowupExecution(db, {
        executionId: id, text: body.text, actor: USER_ACTOR, cfg: ctx.cfg, grantOverrides: overrides,
      });
      const conv = findOrCreateGlobalConversation(db);
      insertMessage(db, {
        conversationId: conv.id, role: 'USER', kind: 'TEXT',
        content: `(follow-up to execution #${id}) ${String(body.text || '').slice(0, 300)}`,
        refType: 'execution', refId: id, actorType: USER_ACTOR.actorType, actorId: USER_ACTOR.actorId,
      });
      return { dispatchId: dspId };
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
      assertHealthyText(body.text, '消息文本');
      return tx(db, () => {
        const msgId = insertMessage(db, {
          conversationId: id, role: 'USER', kind: 'TEXT', content: String(body.text).trim(),
          actorType: USER_ACTOR.actorType, actorId: USER_ACTOR.actorId,
        });
        return msgId;
      });
    },

    bootstrapStatus() {
      const s = ensureSystemEntities(db);
      return {
        ok: true,
        globalConversation: s.globalConversation,
        hubProject: s.hubProject,
        hubGeneralConversation: s.hubGeneralConversation,
      };
    },

    conversationTimeline(id) {
      const conv = findConversation(db, id);
      if (!conv) throw new NotFoundError('conversation', id);
      const messages = listMessages(db, id, { limit: 500 });
      const tasks = db.prepare('SELECT * FROM tasks WHERE conversation_id = ? ORDER BY id DESC LIMIT 200').all(id);
      const executions = db.prepare('SELECT * FROM executions WHERE conversation_id = ? ORDER BY id DESC LIMIT 400').all(id);
      const taskIds = tasks.map((t) => t.id);
      const execIds = executions.map((e) => e.id);
      const placeholders = (n) => Array.from({ length: n }, () => '?').join(',');
      const results = execIds.length
        ? db.prepare(`SELECT * FROM results WHERE execution_id IN (${placeholders(execIds.length)}) ORDER BY id DESC`).all(...execIds)
        : [];
      const candidateIdSet = new Set();
      for (const r of db.prepare('SELECT candidate_id AS c FROM user_commands WHERE conversation_id = ? AND candidate_id IS NOT NULL').all(id)) candidateIdSet.add(r.c);
      for (const r of db.prepare('SELECT candidate_id AS c FROM tasks WHERE conversation_id = ? AND candidate_id IS NOT NULL').all(id)) candidateIdSet.add(r.c);
      const candidateIds = [...candidateIdSet];
      const approvals = candidateIds.length
        ? db.prepare(`SELECT * FROM approvals WHERE candidate_id IN (${placeholders(candidateIds.length)}) ORDER BY id DESC`).all(...candidateIds)
        : [];
      const candidates = candidateIds.length
        ? db.prepare(`SELECT * FROM task_candidates WHERE id IN (${placeholders(candidateIds.length)}) ORDER BY id DESC`).all(...candidateIds)
        : [];
      const candById = Object.fromEntries(candidates.map((c) => [c.id, c]));
      const questions = execIds.length
        ? db.prepare(`SELECT * FROM execution_questions WHERE execution_id IN (${placeholders(execIds.length)}) ORDER BY id DESC`).all(...execIds)
        : [];
      const permissions = execIds.length
        ? db.prepare(`SELECT * FROM permission_requests WHERE execution_id IN (${placeholders(execIds.length)}) ORDER BY id DESC`).all(...execIds)
        : [];
      const applyRequests = taskIds.length
        ? db.prepare(`SELECT * FROM apply_requests WHERE task_id IN (${placeholders(taskIds.length)}) ORDER BY id DESC LIMIT 50`).all(...taskIds)
        : [];
      const items = [];
      for (const m of messages) items.push({ type: 'message', at: m.created_at, data: m });
      for (const t of tasks) items.push({ type: 'task', at: t.created_at, data: t });
      for (const e of executions) items.push({ type: 'execution', at: e.started_at || e.created_at, data: e });
      for (const r of results) items.push({ type: 'result', at: r.created_at, data: r });
      for (const a of approvals) items.push({ type: 'approval', at: a.created_at, data: { ...a, candidate: candById[a.candidate_id] || null } });
      for (const q of questions) items.push({ type: 'question', at: q.asked_at, data: q });
      for (const p of permissions) items.push({ type: 'permission', at: p.asked_at, data: p });
      for (const ar of applyRequests) items.push({ type: 'apply', at: ar.created_at, data: ar });
      items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      return {
        conversation: conv,
        items: items.slice(-500),
        messages,
        tasks,
        executions,
        results,
        approvals: approvals.map((a) => ({ ...a, candidate: candById[a.candidate_id] || null })),
        candidates,
        questions,
        permissions,
        applyRequests,
      };
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
