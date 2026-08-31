'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const { runSandboxed } = require('./exec/runner');
const {
  workerActor, decideWorkerPermission, workerAsksQuestion,
} = require('./approval-policy');

const WORKER_TYPE = 'codex';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

function grantToSandbox(grant, workspace) {
  const caps = grant ? JSON.parse(grant.capabilities_json) : {};
  const network = caps.network || 'ask';
  const write = caps.write_project || 'ask';
  const networkAccess = network === 'allow';
  const approvalPolicy = 'on-request';
  const sandboxType = write === 'allow' ? 'workspaceWrite' : 'readOnly';
  const sandboxPolicy = { type: sandboxType, writableRoots: [workspace], networkAccess };
  return { sandboxPolicy, approvalPolicy, networkMode: network === 'deny' ? 'command-deny' : 'allow' };
}

class CodexWorkerSession {
  constructor(db, ctx, execution, grant, profile) {
    this.db = db;
    this.ctx = ctx;
    this.execution = execution;
    this.grant = grant;
    this.profile = profile;
    this.port = null;
    this.child = null;
    this.ws = null;
    this.nextId = 1;
    this.pendingRpc = new Map();
    this.serverRequests = [];
    this.threadId = null;
    this.turnId = null;
    this.done = false;
    this.failed = null;
    this.finalAnswer = null;
    this.finalItems = [];
    this.pendingApproval = null;
    this.pendingQuestion = null;
    this.task = null;
  }

  prepareProfile() {
    const hostCodex = path.join(process.env.HOME, '.codex');
    const sandboxCodex = path.join(this.profile.home_dir, '.codex');
    fs.mkdirSync(path.join(sandboxCodex, 'sessions'), { recursive: true });
    if (fs.existsSync(path.join(hostCodex, 'auth.json'))) {
      fs.copyFileSync(path.join(hostCodex, 'auth.json'), path.join(sandboxCodex, 'auth.json'));
      fs.chmodSync(path.join(sandboxCodex, 'auth.json'), 0o600);
    }
    const model = (this.ctx.cfg && this.ctx.cfg.workerCodexModel) || 'gpt-5.6-luna';
    fs.writeFileSync(path.join(sandboxCodex, 'config.toml'), `model = "${model}"\n`);
    this.codexHome = sandboxCodex;
  }

  async ensureServer() {
    if (this.child && this.child.exitCode !== null) {
      this.child = null;
      this.ws = null;
    }
    if (this.child) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
      try { await this.connectWs(); } catch (e) { if (this.ctx.logger) this.ctx.logger.warn(`cx-worker[${this.execution.id}] ws reconnect failed: ${e.message}`); }
      return;
    }
    this.prepareProfile();
    this.port = await freePort();
    const network = grantToSandbox(this.grant, this.profile.workspace).networkMode;
    const child = runSandboxed(
      {
        workspace: this.profile.workspace,
        homeDir: this.profile.home_dir,
        network,
        env: [
          'CODEX_HOME=' + this.codexHome,
          'PATH=' + this.profile.workspace + '/.venv/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        ],
      },
      ['/usr/bin/codex', 'app-server', '--listen', `ws://127.0.0.1:${this.port}`],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    child.stdout.on('data', (d) => { if (this.ctx.logger) this.ctx.logger.debug(`cx-worker[${this.execution.id}] ${d.toString().slice(0, 200)}`); });
    child.stderr.on('data', (d) => { if (this.ctx.logger) this.ctx.logger.debug(`cx-worker[${this.execution.id}] ${d.toString().slice(0, 200)}`); });
    child.on('exit', (code) => {
      if (this.ctx.logger) this.ctx.logger.info(`cx-worker[${this.execution.id}] app-server exited code=${code}`);
      if (!this.done && !this.failed) this.failed = `codex app-server exited code=${code}`;
      this.ws = null;
    });
    this.child = child;
    this.profile.worker_port = this.port;
    this.profile.worker_pid = child.pid || null;

    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/readyz`, { signal: AbortSignal.timeout(3000) });
        if (r.ok) break;
      } catch (e) { }
      await new Promise((r) => setTimeout(r, 700));
    }
    await this.connectWs();
  }

  connectWs() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
      const settled = { done: false };
      ws.onopen = async () => {
        this.ws = ws;
        try {
          await this.rpc('initialize', {
            clientInfo: { name: 'personal-hub', title: 'Personal Operations Hub', version: '0.2.0' },
            capabilities: { experimentalApi: true },
          });
          this.send('initialized', {}, true);
          if (!settled.done) { settled.done = true; resolve(); }
        } catch (e) { if (!settled.done) { settled.done = true; reject(e); } }
      };
      ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
      ws.onerror = () => { if (this.ctx.logger) this.ctx.logger.warn(`cx-worker[${this.execution.id}] ws error`); };
      ws.onclose = () => {
        if (this.ctx.logger) this.ctx.logger.warn(`cx-worker[${this.execution.id}] ws closed`);
        this.wsClosedAt = Date.now();
        this.ws = null;
        if (this.pendingApproval) {
          this.failed = this.failed || 'approval channel lost: worker connection closed while waiting for approval';
        }
      };
    });
  }

  send(method, params, isNotification = false) {
    const msg = isNotification ? { method, params } : { id: this.nextId++, method, params };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    return msg.id;
  }

  rpc(method, params, timeoutMs = 90000) {
    const id = this.send(method, params);
    return new Promise((resolve, reject) => {
      this.pendingRpc.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pendingRpc.has(id)) {
          this.pendingRpc.delete(id);
          reject(new Error(`codex timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  onMessage(msg) {
    if (msg.id !== undefined && msg.method) {
      this.serverRequests.push(msg);
      return;
    }
    if (msg.id !== undefined) {
      const p = this.pendingRpc.get(msg.id);
      if (p) {
        this.pendingRpc.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error).slice(0, 300))) : p.resolve(msg);
      }
      return;
    }
    const m = msg.method;
    if (m === 'turn/started' && msg.params.turn) this.turnId = msg.params.turn.id;
    if (m === 'turn/completed') {
      const t = msg.params.turn;
      if (t.status === 'completed') {
        this.done = true;
        this.finalItems = t.items || [];
        const final = this.finalItems.filter((i) => i.type === 'agentMessage' && i.phase === 'final_answer');
        this.finalAnswer = final.length ? final[0].text : (this.finalItems.filter((i) => i.type === 'agentMessage').pop() || {}).text || '';
      } else if (t.status === 'failed') {
        this.failed = 'codex turn failed: ' + JSON.stringify(t.error || '').slice(0, 200);
      } else if (t.status === 'interrupted') {
        this.failed = 'codex turn interrupted';
      }
    }
  }

  async startTurnOnThread(prompt, prefix, needResume) {
    if (needResume) {
      await this.rpc('thread/resume', { threadId: this.threadId });
      const rd = await this.rpc('thread/read', { threadId: this.threadId, includeTurns: true });
      const turns = (rd.result.thread && rd.result.thread.turns) || [];
      for (const t of turns) {
        if (t.status === 'inProgress') {
          try { await this.rpc('turn/interrupt', { threadId: this.threadId, turnId: t.id }, 8000); } catch (e) { }
        }
      }
    }
    const { sandboxPolicy, approvalPolicy } = grantToSandbox(this.grant, this.profile.workspace);
    await this.rpc('turn/start', {
      threadId: this.threadId,
      input: [{ type: 'text', text: prefix ? `${prefix}${prompt}` : prompt }],
      approvalPolicy,
      sandboxPolicy,
    });
    this.promptSentAt = Date.now();
  }

  async startTask(task, prompt) {
    this.task = task;
    await this.ensureServer();
    if (this.profile.session_id) {
      this.threadId = this.profile.session_id;
      await this.startTurnOnThread(prompt, null, true);
      return;
    }
    const th = await this.rpc('thread/start', { cwd: this.profile.workspace, title: `hub-exec-${this.execution.id}` });
    this.threadId = th.result.thread.id;
    this.profile.session_id = this.threadId;
    await this.startTurnOnThread(prompt, null, false);
  }

  async resumeTask(task, prompt) {
    this.task = task;
    await this.ensureServer();
    this.threadId = this.profile.session_id;
    if (!this.threadId) throw new Error('no persisted thread id to resume');
    await this.startTurnOnThread(prompt, '请继续完成之前的任务：', true);
  }

  async pump() {
    if (this.done || this.failed) return;
    try {
      await this.ensureServer();
    } catch (e) {
      this.failed = e.message.slice(0, 300);
      return;
    }
    for (const req of this.serverRequests.splice(0)) {
      await this.handleServerRequest(req);
      if (this.done || this.failed) return;
    }
  }

  async handleServerRequest(req) {
    const m = req.method;
    if (this.ctx.logger) this.ctx.logger.info(`cx-worker[${this.execution.id}] server request ${m} id=${req.id}`);
    if (m === 'item/commandExecution/requestApproval') {
      const p = req.params || {};
      const needsNetwork = !!(p.additionalPermissions && p.additionalPermissions.network && p.additionalPermissions.network.enabled);
      const capability = needsNetwork ? 'network' : 'run_project_commands';
      const res = decideWorkerPermission(this.db, {
        executionId: this.execution.id,
        grant: this.grant,
        capability,
        worker: WORKER_TYPE,
        metadata: { externalId: req.id, command: p.command, reason: p.reason },
        externalId: `cx:${p.itemId || req.id}`,
      });
      if (res.decision === 'ASK_USER') {
        this.pendingApproval = req;
        return;
      }
      this.replyServerRequest(req, res.decision === 'ALLOW' ? 'accept' : 'decline');
    } else if (m === 'item/fileChange/requestApproval') {
      const p = req.params || {};
      const res = decideWorkerPermission(this.db, {
        executionId: this.execution.id,
        grant: this.grant,
        capability: 'write_project',
        worker: WORKER_TYPE,
        metadata: { externalId: req.id, changes: p.itemId },
        externalId: `cx:${p.itemId || req.id}`,
      });
      if (res.decision === 'ASK_USER') {
        this.pendingApproval = req;
        return;
      }
      this.replyServerRequest(req, res.decision === 'ALLOW' ? 'accept' : 'decline');
    } else if (m === 'item/tool/requestUserInput') {
      const q = ((req.params || {}).questions || [{}])[0] || {};
      workerAsksQuestion(this.db, {
        executionId: this.execution.id,
        question: (q.question || 'worker question').slice(0, 300),
        worker: WORKER_TYPE,
        externalId: req.id,
      });
      this.pendingQuestion = req;
    } else {
      this.replyServerRequest(req, '{}');
    }
  }

  replyServerRequest(req, decision) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ id: req.id, result: { decision } }));
      if (this.ctx.logger) this.ctx.logger.info(`cx-worker[${this.execution.id}] replied decision=${decision} to ${req.method} id=${req.id}`);
      return true;
    }
    if (this.ctx.logger) this.ctx.logger.warn(`cx-worker[${this.execution.id}] reply dropped (ws closed) for ${req.method} id=${req.id}`);
    return false;
  }

  async respondToApproval(decision) {
    if (this.ctx.logger) this.ctx.logger.info(`cx-worker[${this.execution.id}] respondToApproval(${decision}) pendingApproval=${this.pendingApproval ? 'set' : 'null'} ws=${this.ws ? this.ws.readyState : 'null'}`);
    if (!this.pendingApproval) return { error: 'NOT_FOUND' };
    const sent = this.replyServerRequest(this.pendingApproval, decision === 'allow' ? 'accept' : 'decline');
    if (!sent) {
      this.failed = this.failed || 'approval channel lost: cannot deliver decision to worker';
      return { error: 'CHANNEL_LOST' };
    }
    this.pendingApproval = null;
    return { ok: true };
  }

  async respondToQuestion(questionId, answer) {
    if (!this.pendingQuestion) return { error: 'NOT_FOUND' };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ id: this.pendingQuestion.id, result: { answer } }));
    }
    this.pendingQuestion = null;
    return { ok: true };
  }

  async cancel() {
    if (this.threadId && this.turnId) {
      try { await this.rpc('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }, 5000); } catch (e) { }
    }
    if (this.child) { try { this.child.kill('SIGTERM'); } catch (e) { } }
  }

  buildResult() {
    const fileChanges = (this.finalItems || []).filter((i) => i.type === 'fileChange');
    const commands = (this.finalItems || []).filter((i) => i.type === 'commandExecution');
    const diff = fileChanges.length ? fileChanges.map((c) => (c.changes || []).map((x) => x.diff).join('\n')).join('\n') : null;
    const outputs = commands.map((c) => (c.stdout || '') + (c.stderr || '')).join('\n');
    let tests = null;
    const tm = outputs.match(/# (tests|pass|fail)\s+(\d+)/g);
    if (tm) {
      const get = (k) => {
        const mm = tm.find((x) => x.startsWith(`# ${k}`));
        return mm ? parseInt(mm.split(/\s+/)[2], 10) : null;
      };
      tests = [{ name: 'worker-tests', status: (get('fail') || 0) === 0 ? 'pass' : 'fail', pass: get('pass'), fail: get('fail'), total: get('tests') }];
    }
    const changedItems = fileChanges.flatMap((c) => (c.changes || []).filter((x) => x.path || x.oldPath));
    const diffLines = (diff || '').split('\n');
    const facts = {
      changedFiles: changedItems.slice(0, 200).map((x) => ({ path: x.path || null, kind: x.kind || null })),
      diffStat: {
        files: changedItems.length,
        additions: diffLines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length,
        deletions: diffLines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length,
      },
      testsRun: tests ? tests[0] : null,
      commitHash: null,
    };
    return {
      summary: this.finalAnswer || '(no final answer)',
      diff,
      tests,
      artifacts: [],
      evidence: {
        worker: WORKER_TYPE,
        threadId: this.threadId,
        turnId: this.turnId,
        fileChanges: fileChanges.length,
        commands: commands.length,
      },
      facts,
    };
  }
}

module.exports = { CodexWorkerSession, WORKER_TYPE, grantToSandbox };
