'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { HubError } = require('../domain/errors');
const { createServiceFacade } = require('../services/facade');

const USER_ACTOR = { actorType: 'USER', actorId: 'owner' };

function statusForError(e) {
  switch (e.code) {
    case 'NOT_FOUND': return 404;
    case 'INVALID_TRANSITION': return 409;
    case 'VERSION_CONFLICT': return 409;
    case 'DUPLICATE': return 409;
    case 'APPROVAL_EXPIRED': return 410;
    case 'GRANT_REVOKED': return 403;
    case 'BAD_REQUEST': return 400;
    default: return 500;
  }
}

function json(res, status, body) {
  if (res.headersSent) {
    try { res.end(); } catch (e) { }
    return;
  }
  const data = JSON.stringify(body === undefined ? { ok: true } : body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  try {
    res.end(data);
  } catch (e) {
    try { res.destroy(); } catch (e2) { }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) { reject(new HubError('BAD_REQUEST', 'body too large')); req.destroy(); }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      let data;
      try {
        data = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      } catch (e) {
        reject(new HubError('BAD_REQUEST', 'request body must be valid UTF-8'));
        return;
      }
      try { resolve(JSON.parse(data)); } catch (e) { reject(new HubError('BAD_REQUEST', 'invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function createApiHandler(db, ctx) {
  const S = createServiceFacade(db, ctx);

  return async function handle(req, res, url) {
    const seg = url.pathname.split('/').filter(Boolean);
    if (seg[0] !== 'api') return false;
    const [root, id, action, subId, subAction] = seg.slice(1);
    const method = req.method;

    try {
      if (method === 'GET' && root === 'status') return json(res, 200, S.status()), true;
      if (method === 'GET' && root === 'dashboard') return json(res, 200, S.dashboard()), true;

      if (root === 'inbox') {
        if (method === 'GET' && id === 'intelligence') return json(res, 200, S.inboxIntelligence()), true;
        if (method === 'POST' && id === 'read') {
          const body = await readBody(req);
          return json(res, 200, S.markInboxRead(body.ids)), true;
        }
        if (method === 'GET' && !id) return json(res, 200, S.inboxList(url.searchParams.get('state'))), true;
        if (method === 'GET' && id) return json(res, 200, S.inboxDetail(Number(id))), true;
        if (method === 'POST' && id && ['read', 'ignore', 'archive', 'convert'].includes(action)) {
          const body = await readBody(req);
          return json(res, 200, S.inboxAction(Number(id), action, body)), true;
        }
      }

      if (root === 'analyses') {
        if (method === 'GET' && id) return json(res, 200, S.analysisDetail(Number(id))), true;
        if (method === 'POST' && id && action === 'feedback') {
          const body = await readBody(req);
          return json(res, 201, S.postAnalysisFeedback(Object.assign({ analysisId: Number(id) }, body))), true;
        }
      }

      if (root === 'intelligence' && id === 'status' && method === 'GET') {
        return json(res, 200, S.intelligenceStatus()), true;
      }

      if (root === 'user-commands' && method === 'POST') {
        const body = await readBody(req);
        return json(res, 201, S.createUserCommand(body)), true;
      }

      if (root === 'candidates') {
        if (method === 'GET' && !id) return json(res, 200, S.candidateList(url.searchParams.get('state'))), true;
        if (method === 'GET' && id) return json(res, 200, S.candidateDetail(Number(id))), true;
        if (method === 'POST' && id && (action === 'approve' || action === 'reject')) {
          const body = await readBody(req);
          return json(res, 200, S.candidateDecision(Number(id), action, body)), true;
        }
      }

      if (root === 'approvals' && method === 'GET') {
        return json(res, 200, S.approvalList(url.searchParams.get('state'))), true;
      }

      if (root === 'tasks') {
        if (method === 'GET' && id === 'buckets') return json(res, 200, S.taskBuckets()), true;
        if (method === 'GET' && !id) return json(res, 200, S.taskList(url.searchParams.get('state'))), true;
        if (method === 'GET' && id) return json(res, 200, S.taskDetail(Number(id))), true;
        if (method === 'POST' && id && action === 'cancel') {
          const body = await readBody(req);
          return json(res, 200, S.cancelTask(Number(id), body)), true;
        }
        if (method === 'POST' && id && action === 'executions') {
          const body = await readBody(req);
          return json(res, 201, S.requestAnotherExecution(Number(id), body)), true;
        }
      }

      if (root === 'attention' && method === 'GET') {
        return json(res, 200, S.attentionList()), true;
      }

      if (root === 'apply-requests') {
        if (method === 'GET') return json(res, 200, S.applyRequestList(url.searchParams.get('state'))), true;
        if (method === 'POST' && id && action === 'status') {
          const body = await readBody(req);
          return json(res, 200, S.markApplyRequestStatus(Number(id), body.state, body.note)), true;
        }
      }

      if (root === 'grants') {
        if (method === 'GET') return json(res, 200, S.grantList(url.searchParams.get('taskId'))), true;
        if (method === 'POST' && id && action === 'revoke') {
          const body = await readBody(req);
          return json(res, 200, S.revokeGrant(Number(id), body)), true;
        }
      }

      if (root === 'executions') {
        if (method === 'GET' && !id) return json(res, 200, S.executionList(url.searchParams.get('state'))), true;
        if (method === 'GET' && id) return json(res, 200, S.executionDetail(Number(id))), true;
        if (method === 'POST' && id && action === 'followup') {
          const body = await readBody(req);
          return json(res, 201, S.followupExecution(Number(id), body)), true;
        }
        if (method === 'POST' && id && action === 'questions' && subId && subAction === 'answer') {
          const body = await readBody(req);
          return json(res, 200, S.answerQuestion(Number(id), Number(subId), body)), true;
        }
        if (method === 'POST' && id && action === 'permissions' && subId && subAction === 'decide') {
          const body = await readBody(req);
          return json(res, 200, S.decidePermission(Number(id), Number(subId), body)), true;
        }
      }

      if (root === 'results') {
        if (method === 'GET' && !id) return json(res, 200, S.resultList(url.searchParams.get('taskId'))), true;
        if (method === 'GET' && id) return json(res, 200, S.resultDetail(Number(id))), true;
        if (method === 'POST' && id && action === 'review') {
          const body = await readBody(req);
          return json(res, 200, S.reviewResult(Number(id), body)), true;
        }
        if (method === 'POST' && id && action === 'prepare-apply') {
          const body = await readBody(req);
          return json(res, 201, S.prepareApplyRequest(Number(id)), true);
        }
      }

      if (root === 'projects') {
        if (method === 'GET' && !id) return json(res, 200, S.projectList()), true;
        if (method === 'GET' && id) return json(res, 200, S.projectDetail(Number(id))), true;
        if (method === 'POST' && !id) {
          const body = await readBody(req);
          return json(res, 201, S.createProject(body)), true;
        }
      }

      if (root === 'bootstrap' && id === 'status' && method === 'GET') {
        return json(res, 200, S.bootstrapStatus()), true;
      }

      if (root === 'conversations') {
        if (method === 'GET' && !id) return json(res, 200, S.conversationList(url.searchParams.get('projectId'))), true;
        if (method === 'POST' && !id) {
          const body = await readBody(req);
          return json(res, 201, S.createConversation(body)), true;
        }
        if (method === 'GET' && id && action === 'timeline') {
          return json(res, 200, S.conversationTimeline(Number(id))), true;
        }
        if (method === 'GET' && id && action === 'messages') {
          return json(res, 200, S.conversationMessages(Number(id), url.searchParams.get('afterId'))), true;
        }
        if (method === 'POST' && id && action === 'messages') {
          const body = await readBody(req);
          return json(res, 201, S.postConversationMessage(Number(id), body)), true;
        }
      }

      if (root === 'transition-log' && method === 'GET') {
        return json(res, 200, S.transitionLog(url.searchParams.get('entityType'), url.searchParams.get('entityId'))), true;
      }
      if (root === 'domain-events' && method === 'GET') {
        return json(res, 200, S.domainEvents(url.searchParams.get('type'))), true;
      }
      if (root === 'outbox' && method === 'GET') {
        return json(res, 200, S.outboxList(url.searchParams.get('state'))), true;
      }

      return false;
    } catch (e) {
      const status = e instanceof HubError ? statusForError(e) : 500;
      if (!(e instanceof HubError)) ctx.logger.error(`api error ${method} ${url.pathname}: ${e.stack || e.message}`);
      json(res, status, { error: { code: e.code || 'INTERNAL', message: e.message } });
      return true;
    }
  };
}

function serveStatic(res, filePath) {
  if (res.headersSent) {
    try { res.end(); } catch (e) { }
    return;
  }
  let content;
  try {
    content = fs.readFileSync(filePath);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    try { res.end('not found'); } catch (e2) { }
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const headers = { 'Content-Type': types[ext] || 'application/octet-stream' };
  if (types[ext]) headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  try { res.end(content); } catch (e) { try { res.destroy(); } catch (e2) { } }
}

function createServer(db, ctx, cfg) {
  const webDir = path.join(__dirname, '..', 'web');
  const api = createApiHandler(db, ctx);
  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (e) {
      json(res, 400, { error: { code: 'BAD_REQUEST', message: 'bad url' } });
      return;
    }
    ctx.logger.debug(`http ${req.method} ${url.pathname}`);
    try {
      const handled = await api(req, res, url);
      if (handled) return;
      let file = url.pathname === '/' ? '/index.html' : url.pathname;
      if (!path.extname(file)) file += '.html';
      serveStatic(res, path.join(webDir, file));
    } catch (e) {
      ctx.logger.error(`server error: ${e.stack || e.message}`);
      json(res, 500, { error: { code: 'INTERNAL', message: e.message } });
    }
  });
}

module.exports = { createServer, json, readBody };
