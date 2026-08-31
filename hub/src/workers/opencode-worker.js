'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const { runSandboxed } = require('./exec/runner');
const {
  workerActor, decideWorkerPermission, workerAsksQuestion, answerWorkerQuestion, userDecidesPermission,
} = require('./approval-policy');
const { findExecution } = require('../domain/execution');
const { applyTransition } = require('../services/state-machine');
const { EXECUTION_TRANSITIONS } = require('../domain/states');
const { tx } = require('../services/tx');

const WORKER_TYPE = 'opencode';

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

function grantToConfig(grant, ctxCfg) {
  const caps = grant ? JSON.parse(grant.capabilities_json) : {};
  const v = (key, dflt) => (caps[key] === undefined ? dflt : caps[key]);
  const modelId = (ctxCfg && ctxCfg.workerOpenCodeModel) || 'deepseek-v4-pro';
  return {
    model: `deepseek/${modelId}`,
    small_model: `deepseek/${modelId}`,
    experimental: {
      policies: [
        { effect: 'deny', action: 'provider.use', resource: '*' },
        { effect: 'allow', action: 'provider.use', resource: 'deepseek' },
      ],
    },
    provider: {
      deepseek: {
        npm: '@ai-sdk/openai-compatible',
        name: 'DeepSeek',
        options: {
          baseURL: 'https://api.deepseek.com/v1',
          apiKey: '{env:DEEPSEEK_API_KEY}',
        },
        models: {
          [modelId]: { name: modelId },
        },
      },
    },
    permission: {
      edit: v('write_project', 'ask'),
      bash: v('run_project_commands', 'ask'),
      webfetch: v('network', 'ask'),
    },
  };
}

class OpenCodeWorkerSession {
  constructor(db, ctx, execution, grant, profile) {
    this.db = db;
    this.ctx = ctx;
    this.execution = execution;
    this.grant = grant;
    this.profile = profile;
    this.base = null;
    this.sessionId = null;
    this.server = null;
    this.events = [];
    this.lastEventAt = 0;
    this.sseReader = null;
    this.done = false;
    this.failed = null;
    this.externalPerms = [];
    this.externalQuestions = [];
    this.task = null;
  }

  async ensureServer() {
    if (this.server && this.base) return;
    const port = await freePort();
    const hostOpenCode = path.join(process.env.HOME, '.opencode');
    const sandboxOpenCode = path.join(this.profile.home_dir, '.opencode');
    fs.mkdirSync(sandboxOpenCode, { recursive: true });
    fs.writeFileSync(path.join(sandboxOpenCode, 'opencode.json'), JSON.stringify(grantToConfig(this.grant, this.ctx.cfg), null, 2));
    const cacheDir = path.join(this.profile.home_dir, '.cache', 'opencode');
    fs.mkdirSync(cacheDir, { recursive: true });
    const hostModels = path.join(process.env.HOME, '.cache', 'opencode', 'models.json');
    if (fs.existsSync(hostModels)) {
      fs.copyFileSync(hostModels, path.join(cacheDir, 'models.json'));
    }
    const hostNodeModules = path.join(hostOpenCode, 'node_modules');
    const profileNodeModules = path.join(sandboxOpenCode, 'node_modules');
    if (fs.existsSync(hostNodeModules) && !fs.existsSync(profileNodeModules)) {
      fs.cpSync(hostNodeModules, profileNodeModules, { recursive: true });
    }
    const extraRoBinds = [];
    if (fs.existsSync(path.join(hostOpenCode, 'bin'))) {
      extraRoBinds.push([path.join(hostOpenCode, 'bin'), '/opt/opencode-bin']);
    }
    const network = this.profile.network_mode || 'command-deny';
    const env = [
      'DEEPSEEK_API_KEY=' + this.ctx.cfg.workerDeepseekApiKey,
      'PATH=' + this.profile.workspace + '/.venv/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    ];
    const child = runSandboxed(
      {
        workspace: this.profile.workspace,
        homeDir: this.profile.home_dir,
        network,
        env,
        extraRoBinds,
      },
      ['/opt/opencode-bin/opencode', 'serve', '--port', String(port), '--hostname', '127.0.0.1'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    child.stdout.on('data', (d) => { if (this.ctx.logger) this.ctx.logger.debug(`oc-worker[${this.execution.id}] ${d.toString().slice(0, 200)}`); });
    child.stderr.on('data', (d) => { if (this.ctx.logger) this.ctx.logger.debug(`oc-worker[${this.execution.id}] ${d.toString().slice(0, 200)}`); });
    child.on('exit', (code) => {
      if (!this.done && !this.failed) this.failed = `opencode serve exited code=${code}`;
      this.server = null;
      this.base = null;
    });
    this.server = child;
    this.profile.worker_port = port;
    this.profile.worker_pid = child.pid || null;
    this.base = `http://127.0.0.1:${port}`;

    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      try {
        const r = await fetch(`${this.base}/doc`, { signal: AbortSignal.timeout(10000) });
        if (this.ctx.logger) this.ctx.logger.info(`oc-worker[${this.execution.id}] /doc status=${r.status} base=${this.base}`);
        if (r.ok) return;
      } catch (e) {
        if (this.ctx.logger) this.ctx.logger.info(`oc-worker[${this.execution.id}] ready retry: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    throw new Error('opencode serve did not become ready in 60s');
  }

  async api(method, p, body) {
    const res = await fetch(this.base + p, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = text.slice(0, 200); }
    if (!res.ok) throw new Error(`opencode ${method} ${p} -> ${res.status}: ${text.slice(0, 200)}`);
    return data;
  }

  async ensureSse() {
    if (this.sseReader) return;
    for (let i = 0; i < 5; i++) {
      try {
        const res = await fetch(`${this.base}/global/event`, { headers: { accept: 'text/event-stream' } });
        this.sseReader = res.body.getReader();
        this.decoder = new TextDecoder();
        this.sseBuf = '';
        this.sseLoop().catch((e) => {
          this.sseReader = null;
          if (this.ctx.logger) this.ctx.logger.debug(`oc-worker[${this.execution.id}] sse end: ${e.message}`);
        });
        return;
      } catch (e) {
        if (this.ctx.logger) this.ctx.logger.info(`oc-worker[${this.execution.id}] sse connect retry ${i + 1}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw new Error('opencode event stream unreachable');
  }

  async sseLoop() {
    while (this.sseReader) {
      const { done, value } = await this.sseReader.read();
      if (done) break;
      this.sseBuf += this.decoder.decode(value, { stream: true });
      const parts = this.sseBuf.split('\n\n');
      this.sseBuf = parts.pop();
      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            this.onEvent(ev);
          } catch (e) { }
        }
      }
    }
  }

  onEvent(raw) {
    const ev = raw.payload || raw;
    const t = ev.type || raw.type || '?';
    const props = ev.properties || ev;
    this.lastEventAt = Date.now();
    if (t === 'permission.v2.asked' && props.id && props.action) {
      this.externalPerms.push(props);
    } else if ((t || '').includes('question') && props.id) {
      this.externalQuestions.push(props);
    } else if (t === 'session.next.step.failed') {
      const err = (props.error || {}).message || 'step failed';
      this.failed = `opencode step failed: ${err}`;
    }
  }

  async startTask(task, prompt) {
    this.task = task;
    await this.ensureServer();
    await this.ensureSse();
    const modelId = (this.ctx.cfg && this.ctx.cfg.workerOpenCodeModel) || 'deepseek-v4-pro';
    const r = await this.api('POST', '/api/session', {
      location: { directory: this.profile.workspace },
      model: { id: modelId, providerID: 'deepseek' },
    });
    this.sessionId = r.data.id;
    this.profile.session_id = this.sessionId;
    await this.api('POST', `/api/session/${this.sessionId}/prompt`, {
      prompt: { text: prompt }, delivery: 'queue',
    });
    this.promptSentAt = Date.now();
  }

  async resumeTask(task, prompt) {
    this.task = task;
    await this.ensureServer();
    await this.ensureSse();
    this.sessionId = this.profile.session_id;
    await this.api('POST', `/api/session/${this.sessionId}/prompt`, {
      prompt: { text: `请继续完成之前的任务：${prompt}` }, delivery: 'queue',
    });
    this.promptSentAt = Date.now();
  }

  async pump() {
    if (this.done) return;
    if (this.failed) {
      this.failed = this.failed.slice(0, 300);
      return;
    }
    try {
      await this.ensureServer();
      await this.ensureSse();
    } catch (e) {
      this.failed = e.message.slice(0, 300);
      return;
    }
    for (const perm of this.externalPerms.splice(0)) {
      await this.handlePermission(perm);
      if (this.done || this.failed) return;
    }
    for (const q of this.externalQuestions.splice(0)) {
      await this.handleQuestion(q);
      if (this.done || this.failed) return;
    }
    await this.maybeComplete();
  }

  capabilityFor(action) {
    const map = { bash: 'run_project_commands', edit: 'write_project', read: 'read_project', webfetch: 'network' };
    return map[action] || action;
  }

  async handlePermission(perm) {
    const capability = this.capabilityFor(perm.action);
    const res = decideWorkerPermission(this.db, {
      executionId: this.execution.id,
      grant: this.grant,
      capability,
      worker: WORKER_TYPE,
      metadata: { externalId: perm.id, action: perm.action, resources: perm.resources },
      externalId: `oc:${perm.id}`,
    });
    if (res.decision === 'ASK_USER') {
      this.pendingApproval = perm;
      return;
    }
    const reply = res.decision === 'ALLOW' ? 'once' : 'reject';
    await this.api('POST', `/api/session/${this.sessionId}/permission/${perm.id}/reply`, { reply });
  }

  async handleQuestion(q) {
    const qId = workerAsksQuestion(this.db, {
      executionId: this.execution.id,
      question: (q.title || q.question || 'worker question').slice(0, 300),
      worker: WORKER_TYPE,
      externalId: q.id,
    });
    this.pendingQuestion = { qId, externalId: q.id };
  }

  async respondToApproval(decision) {
    const perm = this.pendingApproval;
    if (!perm) return { error: 'NOT_FOUND' };
    await this.api('POST', `/api/session/${this.sessionId}/permission/${perm.id}/reply`, {
      reply: decision === 'allow' ? 'once' : 'reject',
    });
    this.pendingApproval = null;
    return { ok: true };
  }

  async respondToQuestion(questionId, answer) {
    const q = this.pendingQuestion;
    if (!q) return { error: 'NOT_FOUND' };
    await this.api('POST', `/api/session/${this.sessionId}/question/${q.externalId}/reply`, {
      answers: [[answer]],
    });
    this.pendingQuestion = null;
    return { ok: true };
  }

  async maybeComplete() {
    if (this.done || this.failed) return;
    if (!this.sessionId) return;
    if (this.profile.state === 'WAITING') return;
    let messages;
    try {
      messages = await this.api('GET', `/api/session/${this.sessionId}/message`);
    } catch (e) {
      return;
    }
    const list = (messages.data && messages.data.data) || [];
    const assistant = list.find((m) => m.type === 'assistant');
    if (!assistant) return;
    const busy = (assistant.content || []).some((c) => c.type === 'tool' && c.state && c.state.status === 'running');
    const quiet = Date.now() - this.lastEventAt > 4000 && Date.now() - (this.promptSentAt || 0) > 6000;
    if (busy || !quiet) return;
    const texts = (assistant.content || []).filter((c) => c.type === 'text').map((c) => c.text);
    const summary = texts.join('\n').trim();
    if (!summary) return;
    this.done = true;
    this.finalSummary = summary;
    this.finalMessages = list;
  }

  async cancel() {
    if (this.sessionId) {
      try { await this.api('POST', `/api/session/${this.sessionId}/interrupt`); } catch (e) { }
    }
    if (this.server) { try { this.server.kill('SIGTERM'); } catch (e) { } }
  }

  buildResult() {
    let tests = null;
    let diff = null;
    const toolOutputs = [];
    for (const m of this.finalMessages || []) {
      for (const c of m.content || []) {
        if (c.type === 'tool' && c.state && c.state.output) {
          toolOutputs.push(JSON.stringify(c.state.output));
        }
      }
    }
    const joined = toolOutputs.join('\n');
    const tm = joined.match(/# (tests|pass|fail)\s+(\d+)/g);
    if (tm) {
      const get = (k) => {
        const mm = tm.find((x) => x.startsWith(`# ${k}`));
        return mm ? parseInt(mm.split(/\s+/)[2], 10) : null;
      };
      tests = [{ name: 'worker-tests', status: (get('fail') || 0) === 0 ? 'pass' : 'fail', pass: get('pass'), fail: get('fail'), total: get('tests') }];
    }
    return {
      summary: this.finalSummary,
      diff,
      tests,
      artifacts: [],
      evidence: {
        worker: WORKER_TYPE,
        sessionId: this.sessionId,
        permissionCount: 0,
        prompt: this.task ? this.task.title : null,
      },
    };
  }
}

module.exports = { OpenCodeWorkerSession, WORKER_TYPE, grantToConfig };
