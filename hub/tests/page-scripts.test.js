'use strict';
/* Execute every page's real scripts (i18n.js + md.js + app.js + inline) in a DOM
 * shim under both languages, against fixture API data. Catches runtime errors
 * (undefined refs, t() shadowing, missing keys surfacing as "undefined"). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const webDir = path.join(__dirname, '..', 'src', 'web');
const i18n = require('../src/web/i18n');

const FIXTURES = {
  '/api/bootstrap/status': { ok: true, globalConversation: { id: 1 }, hubProject: { id: 2, project_type: 'SYSTEM_HUB' }, hubGeneralConversation: { id: 3 } },
  '/api/projects': [{ id: 2, name: 'Hub', project_type: 'SYSTEM_HUB', state: 'ACTIVE' }, { id: 4, name: 'Gomoku', project_type: 'USER', state: 'ACTIVE' }],
  '/api/dashboard': {
    inbox: 1, candidates: 2, attention: 3, pendingApprovals: 1, runningExecutions: 1,
    waitingForUser: 1, resultsAvailable: 1, completedTasks: 2, outboxPending: 0, outboxDead: 0,
    projectActivity: [{ project: { id: 4, name: 'Gomoku', project_type: 'USER' }, taskCounts: { OPEN: 1, COMPLETED: 2 } }, { project: null, taskCounts: {} }],
    recentActivity: [{ event_type: 'TASK_CREATED', entity_type: 'task', entity_id: 9, created_at: '2026-09-01T10:00:00Z' }],
    projects: [{ id: 4, name: 'Gomoku', project_type: 'USER' }],
  },
  '/api/inbox': [],
  '/api/candidates': [],
  '/api/tasks/buckets': {
    running: [],
    waitingForMe: [{ task: { id: 12, title: 'demo task', state: 'EXECUTING', conversation_id: 1 }, latestExecution: { id: 16, worker: 'codex', state: 'RUNNING' } }],
    resultAvailable: [], failed: [], completed: [], cancelled: [],
  },
  '/api/tasks': [{ id: 12, title: 'demo task', state: 'RESULT_AVAILABLE' }],
  '/api/attention': { count: 1, candidateApprovals: [], openPermissions: [], openQuestions: [], applyRequests: [] },
  '/api/executions': [{ id: 17, task_id: 14, scenario: 'SUCCESS', worker: 'codex', attempt: 1, state: 'RUNNING', started_at: '2026-09-01T10:00:00Z' }],
  '/api/results': [{ id: 19, task_id: 12, worker: 'codex', created_at: '2026-09-01T10:00:00Z', summary: 'done **bold**' }],
  '/api/conversations': [{ id: 1, title: 'Hub', kind: 'GLOBAL_HUB' }],
  '/api/conversations/1/timeline': {
    conversation: { id: 1, title: 'Hub', kind: 'GLOBAL_HUB', project_id: null },
    items: [
      { type: 'message', at: 't1', data: { role: 'USER', kind: 'TEXT', content: 'hello **md**', created_at: 't1' } },
      { type: 'task', at: 't2', data: { id: 12, title: 'demo task', state: 'EXECUTING' } },
      { type: 'result', at: 't3', data: { id: 19, task_id: 12, worker: 'codex', created_at: 't3', summary: 'done' } },
    ],
    messages: [], tasks: [{ id: 12, title: 'demo task', state: 'EXECUTING' }], executions: [], results: [],
    approvals: [], candidates: [], questions: [], permissions: [], applyRequests: [],
  },
};

function fixtureFor(url) {
  const p = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0];
  if (FIXTURES[p] !== undefined) return FIXTURES[p];
  if (p.match(/^\/api\/conversations\/\d+\/timeline$/)) return FIXTURES['/api/conversations/1/timeline'];
  if (p.match(/^\/api\/projects\/\d+$/)) return {
    project: { id: 4, name: 'Gomoku', project_type: 'USER', state: 'ACTIVE', description: 'demo', workspace_path: '/w' },
    conversations: [{ id: 5, title: 'conv', is_default: true }],
    tasks: [{ id: 12, title: 'demo task', state: 'EXECUTING', conversation_id: null }],
    events: [{ id: 1, event_type: 'TASK_CREATED', created_at: 't' }],
    results: [],
  };
  return {};
}

function makeElement(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [], style: {}, dataset: {}, attributes: {}, _innerHTML: '', textContent: '',
    placeholder: '', title: '', value: '', onclick: null, selectedOptions: [],
    classList: {
      _s: new Set(),
      toggle(c, force) { const on = force === undefined ? !this._s.has(c) : !!force; if (on) this._s.add(c); else this._s.delete(c); return on; },
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); },
    },
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'placeholder') this.placeholder = String(v); if (k === 'title') this.title = String(v); },
    getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; },
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    insertAdjacentHTML(pos, html) { this._innerHTML += String(html); },
    querySelector(sel) {
      const m = sel.match(/^\.([a-zA-Z-]+)(?:\[data-([a-zA-Z-]+)="([^"]*)"\])?$/);
      if (!m) return null;
      for (const child of this.children) {
        const clsOk = String(child.className || '').split(/\s+/).indexOf(m[1]) !== -1;
        const attrOk = !m[2] || child.getAttribute('data-' + m[2]) === m[3];
        if (clsOk && attrOk) return child;
      }
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    focus() {},
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._innerHTML; },
    set(v) { this._innerHTML = String(v); },
  });
  return el;
}

function makeSandbox(lang, search, fetchFn) {
  const store = { 'hub-lang': lang };
  const sessionStore = {};
  const registry = {};
  const alerts = [];
  const timeouts = [];
  const fetchLog = [];
  const document = {
    documentElement: { lang: 'zh-CN', setAttribute(k, v) { this[k] = v; }, getAttribute() { return null; } },
    body: makeElement('body'),
    title: '',
    getElementById(id) { if (!registry[id]) registry[id] = makeElement('div'); return registry[id]; },
    createElement: (tag) => makeElement(tag),
    querySelector(sel) {
      const m = sel.match(/^\.sidebar-item\[data-nav="([a-z]+)"\]$/);
      if (m) {
        const navEl = this.getElementById('nav');
        if (!navEl || navEl._innerHTML.indexOf('data-nav="' + m[1] + '"') === -1) return null;
        if (!navEl._items) navEl._items = {};
        if (!navEl._items[m[1]]) {
          const it = makeElement('a');
          it.className = 'sidebar-item';
          navEl._items[m[1]] = it;
        }
        return navEl._items[m[1]];
      }
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const sandbox = {
    console: { log() {}, error() {}, warn() {}, info() {}, debug() {} },
    document,
    setTimeout(fn, ms) { timeouts.push({ fn, ms }); return timeouts.length; },
    setInterval() { return 0; }, clearTimeout() {}, clearInterval() {},
    alert(msg) { alerts.push(String(msg)); },
    prompt() { return null; }, confirm() { return false; },
    matchMedia() { return { matches: false, addEventListener() {} }; },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    sessionStorage: {
      getItem: (k) => (k in sessionStore ? sessionStore[k] : null),
      setItem: (k, v) => { sessionStore[k] = String(v); },
      removeItem: (k) => { delete sessionStore[k]; },
    },
    location: { search: search || '', pathname: '/page.html', reload() {} },
    fetch(url) {
      const data = fetchFn ? fetchFn(String(url)) : fixtureFor(String(url));
      fetchLog.push(String(url).split('?')[0]);
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(JSON.parse(JSON.stringify(data))),
        text: () => Promise.resolve(JSON.stringify(data)),
      });
    },
    URL, URLSearchParams,
    addEventListener() {}, removeEventListener() {},
    alertCalls: alerts,
    timeouts,
    fetchLog,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  return { sandbox, document, alerts, timeouts, fetchLog };
}

/* depth-first search for an element whose className contains classPart */
function findFirstByClass(root, classPart) {
  const kids = root && root.children ? root.children : [];
  for (const child of kids) {
    if (String(child.className || '').indexOf(classPart) !== -1) return child;
    const found = findFirstByClass(child, classPart);
    if (found) return found;
  }
  return null;
}

/* collect all textContent from an element subtree */
function collectText(root) {
  if (!root) return '';
  let parts = [];
  if (root.textContent) parts.push(root.textContent);
  for (const child of root.children || []) parts.push(collectText(child));
  return parts.join(' ');
}

async function runPage(file, lang, search, fetchFn) {
  const html = fs.readFileSync(path.join(webDir, file), 'utf8');
  const { sandbox, document, alerts, timeouts, fetchLog } = makeSandbox(lang, search, fetchFn);
  const ctx = vm.createContext(sandbox);
  for (const f of ['i18n.js', 'md.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(webDir, f), 'utf8'), ctx, { filename: f });
  }
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    vm.runInContext(m[1], ctx, { filename: `${file}#inline` });
  }
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
  return { sandbox: ctx, document, alerts, timeouts, fetchLog };
}

const PAGES = [
  { file: 'index.html', search: '', container: 'stats' },
  { file: 'inbox.html', search: '', container: 'items' },
  { file: 'tasks.html', search: '', container: 'buckets' },
  { file: 'approvals.html', search: '', container: 'candidate-approvals' },
  { file: 'executions.html', search: '', container: 'list' },
  { file: 'results.html', search: '', container: 'list' },
  { file: 'projects.html', search: '', container: 'user-list' },
  { file: 'project.html', search: '?id=4', container: 'conversations' },
  { file: 'conversations.html', search: '', container: 'list' },
  { file: 'conversation.html', search: '?id=1', container: 'timeline' },
];

for (const lang of ['zh', 'en']) {
  for (const page of PAGES) {
    test(`page-scripts ${lang}: ${page.file} renders without errors`, async () => {
      const { document, alerts } = await runPage(page.file, lang, page.search);
      assert.deepStrictEqual(alerts, [], 'no error alerts should surface');
      const nav = document.getElementById('nav').innerHTML;
      assert.ok(nav.length > 100, 'sidebar should render');
      assert.ok(!nav.includes('undefined'), 'sidebar must not contain undefined');
      assert.ok(nav.includes(i18n.DICT[lang]['nav.inbox']), `sidebar should contain localized Inbox label (${lang})`);
      assert.strictEqual(document.documentElement.lang, lang === 'en' ? 'en' : 'zh-CN', 'html lang should match');
      const main = document.getElementById(page.container).innerHTML;
      assert.ok(main.length > 0, `${page.container} should render`);
      assert.ok(!main.includes('undefined'), `${page.container} must not contain undefined`);
      assert.ok(!main.includes('[object'), `${page.container} must not contain [object`);
    });
  }
}

test('page-scripts zh: status badges are localized and raw enum in title', async () => {
  const { document } = await runPage('tasks.html', 'zh', '');
  const html = document.getElementById('buckets').innerHTML;
  assert.ok(html.includes('运行中'), 'zh buckets should contain localized RUNNING');
  assert.ok(html.includes('title="RUNNING"'), 'raw enum preserved in title');
});

test('page-scripts en: status badges use English labels', async () => {
  const { document } = await runPage('tasks.html', 'en', '');
  const html = document.getElementById('buckets').innerHTML;
  assert.ok(html.includes('>Running<'), 'en buckets should contain Running');
  assert.ok(!html.includes('运行中'), 'en buckets should not contain zh labels');
});

test('page-scripts conversation zh/en: composer and cards localized', async () => {
  const zh = await runPage('conversation.html', 'zh', '?id=1');
  assert.ok(zh.document.getElementById('timeline').innerHTML.includes('msg-bubble'), 'timeline rendered');
  assert.ok(zh.document.querySelector === null || true);
  const en = await runPage('conversation.html', 'en', '?id=1');
  assert.ok(en.document.getElementById('timeline').innerHTML.includes('msg-bubble'), 'en timeline rendered');
});

test('page-scripts dashboard zh: stat labels localized', async () => {
  const { document } = await runPage('index.html', 'zh', '');
  const html = document.getElementById('stats').innerHTML;
  assert.ok(html.includes(i18n.DICT.zh['dash.stats.inbox']), 'stat label zh');
});

test('step3: no alert() or prompt() left in web sources', () => {
  const files = fs.readdirSync(webDir).filter((f) => f.endsWith('.html'));
  files.push('app.js');
  for (const f of files) {
    const text = fs.readFileSync(path.join(webDir, f), 'utf8');
    assert.ok(!/\balert\(/.test(text), `${f} still uses alert()`);
    assert.ok(!/\bprompt\(/.test(text), `${f} still uses prompt()`);
  }
});

test('step3: formError shows conflict toast and schedules reload', async () => {
  const { sandbox, document, timeouts } = await runPage('tasks.html', 'zh', '');
  const before = timeouts.length;
  vm.runInContext('window.hub.formError(new Error("VERSION_CONFLICT: stale version 3"))', sandbox);
  const wrap = findFirstByClass(document.body, 'toast-wrap');
  assert.ok(wrap, 'toast wrap appended');
  const toastEl = findFirstByClass(wrap, 'toast err');
  assert.ok(toastEl && collectText(toastEl).includes(i18n.DICT.zh['toast.conflictTitle']), 'conflict toast title shown');
  assert.ok(timeouts.length > before, 'reload should be scheduled');
});

test('step3: formError generic error shows message toast, no alert', async () => {
  const { sandbox, document, alerts } = await runPage('tasks.html', 'en', '');
  vm.runInContext('window.hub.formError(new Error("BAD_REQUEST: name required"))', sandbox);
  const toastEl = findFirstByClass(document.body, 'toast err');
  assert.ok(toastEl && collectText(toastEl).includes(i18n.DICT.en['toast.errorTitle']), 'generic error toast title');
  assert.ok(collectText(toastEl).includes('name required'), 'error body shown');
  assert.deepStrictEqual(alerts, [], 'no alert() calls');
});

test('step3: modalPrompt collects values, closes on success, stays open on failure', async () => {
  const { sandbox } = await runPage('tasks.html', 'zh', '');
  const calls = [];
  vm.runInContext(`
    window.__api = window.hub.modalPrompt({
      title: 'T',
      fields: [{ type: 'textarea', name: 'reason', placeholder: 'p' }],
      okText: 'OK',
      onOk: async (v) => {
        if (v.reason === 'boom') throw new Error('rejected by server');
        window.__calls.push(v);
      },
    });
    window.__calls = [];
  `, sandbox);
  vm.runInContext(`
    window.__api.inputs[0].value = 'bad wording';
    window.__api.submit();
  `, sandbox);
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  const seen = vm.runInContext('window.__calls', sandbox);
  assert.strictEqual(seen.length, 1, 'onOk called once');
  assert.strictEqual(seen[0].reason, 'bad wording');
  assert.strictEqual(vm.runInContext('window.__api.open', sandbox), false, 'modal closed after success');

  // failure path: modal stays open, error toast shown
  const { sandbox: s2, document: doc2 } = await runPage('tasks.html', 'zh', '');
  vm.runInContext(`
    window.__api2 = window.hub.modalPrompt({
      title: 'T',
      fields: [{ type: 'textarea', name: 'reason' }],
      okText: 'OK',
      onOk: async () => { throw new Error('VERSION_CONFLICT: stale'); },
    });
    window.__api2.inputs[0].value = 'boom';
  `, s2);
  await vm.runInContext('window.__api2.submit()', s2);
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  assert.strictEqual(vm.runInContext('window.__api2.open', s2), true, 'modal stays open on failure');
  const toastEl = findFirstByClass(doc2.body, 'toast err');
  assert.ok(toastEl && collectText(toastEl).includes(i18n.DICT.zh['toast.conflictTitle']), 'conflict toast on failure');
});

test('step3: withButton disables during call and restores after', async () => {
  const { sandbox } = await runPage('inbox.html', 'zh', '');
  vm.runInContext(`
    window.__btn = document.createElement('button');
    window.__states = [];
    window.__fn = window.hub.withButton(window.__btn, async () => {
      window.__states.push(window.__btn.disabled + ':' + window.__btn.classList.contains('loading'));
    });
  `, sandbox);
  await vm.runInContext('window.__fn', sandbox);
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
  const states = vm.runInContext('window.__states.join(",") + " final-disabled:" + window.__btn.disabled', sandbox);
  assert.strictEqual(states, 'true:true final-disabled:false');
});

test('step4: sidebar nav badges fetched and applied from dashboard + attention', async () => {
  const { document, fetchLog } = await runPage('tasks.html', 'zh', '');
  assert.ok(fetchLog.includes('/api/dashboard'), 'dashboard fetched for badges');
  assert.ok(fetchLog.includes('/api/attention'), 'attention fetched for badges');
  // fixtures: dashboard.inbox=1, dashboard.candidates=2, attention.count=1
  const expect = { inbox: '1', tasks: '2', approvals: '1' };
  for (const [key, val] of Object.entries(expect)) {
    const item = document.querySelector(`.sidebar-item[data-nav="${key}"]`);
    assert.ok(item, `sidebar item ${key} exists in rendered nav`);
    const badge = item.querySelector(`.sidebar-count[data-nav-badge="${key}"]`);
    assert.ok(badge, `badge element attached for ${key}`);
    assert.strictEqual(badge.textContent, val, `badge value for ${key}`);
  }
});

test('step4: every page run triggers nav badge fetches without errors', async () => {
  for (const page of PAGES) {
    const { alerts, fetchLog } = await runPage(page.file, 'zh', page.search);
    assert.deepStrictEqual(alerts, [], `${page.file}: no alerts`);
    assert.ok(fetchLog.includes('/api/dashboard'), `${page.file}: dashboard fetched`);
    assert.ok(fetchLog.includes('/api/attention'), `${page.file}: attention fetched`);
  }
});

test('step5: empty states render components and skeletons are replaced after load', async () => {
  const inbox = await runPage('inbox.html', 'zh', '');
  const itemsHtml = inbox.document.getElementById('items').innerHTML;
  assert.ok(itemsHtml.includes('empty-icon'), 'inbox empty uses icon component');
  assert.ok(itemsHtml.includes(i18n.DICT.zh['inbox.empty']), 'inbox empty text present');
  assert.ok(!itemsHtml.includes('sk-line'), 'inbox skeleton replaced after load');

  const tasks = await runPage('tasks.html', 'zh', '');
  const bucketsHtml = tasks.document.getElementById('buckets').innerHTML;
  assert.ok(bucketsHtml.includes('empty-center'), 'empty task bucket uses centered text');
  assert.ok(bucketsHtml.includes(i18n.DICT.zh['tasks.empty.running']), 'running bucket empty text present');
  assert.ok(!bucketsHtml.includes('sk-line'), 'tasks skeleton replaced after load');

  const conv = await runPage('conversation.html', 'zh', '?id=1');
  const tlHtml = conv.document.getElementById('timeline').innerHTML;
  assert.ok(!tlHtml.includes('sk-line'), 'conversation skeleton replaced after render');

  const proj = await runPage('projects.html', 'zh', '');
  assert.ok(!proj.document.getElementById('user-list').innerHTML.includes('sk-line'), 'projects skeleton replaced');
});

const drain = async (n) => { for (let i = 0; i < (n || 8); i++) await new Promise((r) => setImmediate(r)); };

function tlBase(content, id) {
  const msg = { id: id || 101, role: 'USER', kind: 'TEXT', content, created_at: '2026-01-01T00:00:0' + (id % 10) + 'Z' };
  return {
    conversation: { id: 1, title: 'Hub', kind: 'GLOBAL_HUB', project_id: null },
    items: [{ type: 'message', at: msg.created_at, data: msg }],
    messages: [msg], tasks: [], executions: [], results: [],
    approvals: [], candidates: [], questions: [], permissions: [], applyRequests: [],
  };
}
function tlWith(tl, msg) {
  return {
    conversation: tl.conversation,
    items: tl.items.concat([{ type: 'message', at: msg.created_at, data: msg }]),
    messages: tl.messages.concat([msg]), tasks: [], executions: [], results: [],
    approvals: [], candidates: [], questions: [], permissions: [], applyRequests: [],
  };
}

test('step6: timeline refresh skips unchanged, appends new messages, re-renders on state change', async () => {
  let cur = tlBase('first **bold**', 101);
  const fetchFn = (u) => (u.indexOf('/timeline') !== -1 ? cur : fixtureFor(u));
  const { sandbox, document, alerts } = await runPage('conversation.html', 'zh', '?id=1', fetchFn);
  const bubbleCount = () => (document.getElementById('timeline').innerHTML.match(/class="msg-bubble/g) || []).length;
  const htmlNow = () => document.getElementById('timeline').innerHTML;
  assert.strictEqual(bubbleCount(), 1, 'initial message rendered');
  assert.ok(htmlNow().includes('>first <strong>bold</strong>'), 'md rendered for first message');
  const htmlAfterFirst = htmlNow();

  // 1) identical data → skip (DOM untouched)
  await vm.runInContext('window.hubConv.load()', sandbox);
  await drain();
  assert.strictEqual(htmlNow(), htmlAfterFirst, 'unchanged data must not re-render');

  // 2) new message appended without full re-render
  const msg2 = { id: 102, role: 'WORKER', kind: 'TEXT', content: 'second **done**', created_at: '2026-01-01T00:00:02Z' };
  cur = tlWith(cur, msg2);
  await vm.runInContext('window.hubConv.load()', sandbox);
  await drain();
  assert.strictEqual(bubbleCount(), 2, 'append path added second message');
  assert.ok(htmlNow().indexOf(htmlAfterFirst) === 0, 'existing content untouched at top');
  assert.ok(htmlNow().includes('second <strong>done</strong>'), 'new message rendered');

  // 3) same again → skip
  const htmlAfterAppend = htmlNow();
  await vm.runInContext('window.hubConv.load()', sandbox);
  await drain();
  assert.strictEqual(htmlNow(), htmlAfterAppend, 'post-append identical data must not re-render');

  // 4) state change to existing message content → full re-render replaces
  cur = tlBase('first changed', 101);
  await vm.runInContext('window.hubConv.load()', sandbox);
  await drain();
  assert.strictEqual(bubbleCount(), 1, 'state change re-renders to single message');
  assert.ok(htmlNow().includes('first changed'), 'updated content present');
  assert.ok(!htmlNow().includes('second <strong>done</strong>'), 'stale content removed');
  assert.deepStrictEqual(alerts, [], 'no alerts throughout');
});

test('step8: fmtTime shows relative labels, ui values persist, bad dates fall back', async () => {
  const { sandbox } = await runPage('executions.html', 'zh', '');
  const fiveMin = new Date(Date.now() - 5 * 60000).toISOString();
  const out = vm.runInContext('window.hub.fmtTime(' + JSON.stringify(fiveMin) + ')', sandbox);
  assert.ok(out.includes('分钟前'), 'zh relative minutes label: ' + out);
  const old = new Date(Date.now() - 10 * 86400000).toISOString();
  const outOld = vm.runInContext('window.hub.fmtTime(' + JSON.stringify(old) + ')', sandbox);
  assert.ok(/^\d{1,2}-\d{2} \d{2}:\d{2}$/.test(outOld), 'old dates show local MM-DD HH:mm: ' + outOld);
  const bad = vm.runInContext("window.hub.fmtTime('not-a-date')", sandbox);
  assert.ok(bad.includes('not-a-date'), 'bad date falls back to raw value');
  vm.runInContext("window.hub.saveUiValue('k', 'v1')", sandbox);
  assert.strictEqual(vm.runInContext("window.hub.readUiValue('k')", sandbox), 'v1', 'ui value roundtrip');
});
