'use strict';

/* ---------- 图标（Lucide 风格内联 SVG，零依赖） ---------- */
const ICONS = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  tasks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  approvals: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  executions: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  results: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>',
  conversations: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  alertCircle: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  package: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  key: '<path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  menu: '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
};

function icon(name, size) {
  const s = size || 16;
  return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
}

/* ---------- 主题（auto / light / dark，localStorage 持久化，防闪白脚本见各页 head） ---------- */
const THEME_KEY = 'hub-theme';

function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; }
}
function resolvedTheme() {
  const t = getTheme();
  if (t !== 'auto') return t;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function applyTheme() {
  document.documentElement.setAttribute('data-bs-theme', resolvedTheme());
  renderThemeButton();
}
function setTheme(v) {
  try { localStorage.setItem(THEME_KEY, v); } catch (e) { /* ignore */ }
  applyTheme();
}
function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  setTheme(order[(order.indexOf(getTheme()) + 1) % order.length]);
}
function renderThemeButton() {
  const btn = document.getElementById('themeBtn');
  if (!btn) return;
  const t = getTheme();
  const ic = t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'monitor';
  btn.innerHTML = icon(ic, 14) + '<span>' + i18n.t('theme.' + t) + '</span>';
}
function renderLangButton() {
  const btn = document.getElementById('langBtn');
  if (!btn) return;
  btn.innerHTML = icon('globe', 14) + '<span>' + (i18n.getLang() === 'zh' ? 'English' : '中文') + '</span>';
}
function toggleLang() {
  i18n.setLang(i18n.getLang() === 'zh' ? 'en' : 'zh');
}
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'auto') applyTheme();
  });
}

/* ---------- API ---------- */
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
  if (!res.ok) throw new Error(data.error ? `${data.error.code}: ${data.error.message}` : `HTTP ${res.status}`);
  return data;
}

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 状态徽章（低饱和软色，黑白灰基调下的语义点缀） ---------- */
const BADGE_COLORS = {
  NEW: 'accent', READ: 'neutral', IGNORED: 'neutral', ARCHIVED: 'neutral', CONVERTED: 'accent',
  OPEN: 'neutral', EXECUTING: 'violet', RESULT_AVAILABLE: 'success', REVIEW: 'warning',
  COMPLETED: 'success', CANCELLED: 'neutral',
  PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', EXPIRED: 'neutral',
  QUEUED: 'neutral', DISPATCHED: 'violet', RUNNING: 'violet',
  WAITING_FOR_USER: 'warning', WAITING_FOR_APPROVAL: 'warning', FAILED: 'danger',
  DEAD: 'danger', ACTIVE: 'success', REVOKED: 'neutral',
  ALLOWED: 'success', DENIED: 'danger', ANSWERED: 'success', ASKED_USER: 'warning',
  PREPARED: 'warning', APPLIED: 'success', ROLLED_BACK: 'neutral', SUPERSEDED: 'neutral',
};

function badge(state) {
  const c = BADGE_COLORS[state] || 'neutral';
  return '<span class="badge b-' + c + '" title="' + esc(state) + '"><i class="dot"></i>' + esc(i18n.statusLabel(state)) + '</span>';
}

/* ---------- 卡片类型标识（中性灰：图标 + 类型名） ---------- */
const TYPE_META = {
  task: ['tasks', 'type.task'],
  execution: ['executions', 'type.execution'],
  result: ['results', 'type.result'],
  approval: ['approvals', 'type.approval'],
  apply: ['package', 'type.apply'],
  perm: ['key', 'type.perm'],
  question: ['question', 'type.question'],
};

function typeChip(kind) {
  const m = TYPE_META[kind];
  if (!m) return '';
  return '<span class="type-chip">' + icon(m[0], 13) + esc(i18n.t(m[1])) + '</span>';
}

/* ---------- 侧边栏 ---------- */
let navState = null;

async function loadNavState() {
  if (navState) return navState;
  try {
    const boot = await api('GET', '/api/bootstrap/status');
    const projects = await api('GET', '/api/projects');
    navState = { globalConversationId: boot.globalConversation.id, projects };
  } catch (e) {
    navState = { globalConversationId: null, projects: [] };
  }
  return navState;
}

function sidebarItem(href, key, labelHtml, active, iconName) {
  return `<a class="sidebar-item ${active === key ? 'active' : ''}" data-nav="${key}" href="${href}">${icon(iconName, 16)}<span>${labelHtml}</span></a>`;
}

async function nav(active) {
  const s = await loadNavState();
  const homeHref = s.globalConversationId ? `/conversation.html?id=${s.globalConversationId}` : '/conversations.html';
  const hubProjects = s.projects.filter((p) => p.project_type === 'SYSTEM_HUB');
  const userProjects = s.projects.filter((p) => p.project_type !== 'SYSTEM_HUB');
  const projectLink = (p, badgeHtml) =>
    sidebarItem(`/project.html?id=${p.id}`, 'projects', `${esc(p.name)} ${badgeHtml}`, active, 'folder');
  return `
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-brand"><span class="brand-mark">H</span><a href="/">Personal Hub</a></div>
    <nav class="sidebar-nav">
      <div class="sidebar-section">${i18n.t('nav.main')}</div>
      ${sidebarItem(homeHref, 'home', i18n.t('nav.home'), active, 'home')}
      <div class="sidebar-section">${i18n.t('nav.projects')}</div>
      ${hubProjects.map((p) => projectLink(p, `<span class="sidebar-tag">${i18n.t('nav.tagSystem')}</span>`)).join('')}
      ${userProjects.map((p) => projectLink(p, '')).join('')}
      ${sidebarItem('/projects.html', 'projects-admin', i18n.t('nav.manageProjects'), active, 'sliders')}
      <div class="sidebar-section">${i18n.t('nav.workspace')}</div>
      ${sidebarItem('/inbox.html', 'inbox', i18n.t('nav.inbox'), active, 'inbox')}
      ${sidebarItem('/tasks.html', 'tasks', i18n.t('nav.tasks'), active, 'tasks')}
      ${sidebarItem('/approvals.html', 'approvals', i18n.t('nav.approvals'), active, 'approvals')}
      ${sidebarItem('/executions.html', 'executions', i18n.t('nav.executions'), active, 'executions')}
      ${sidebarItem('/results.html', 'results', i18n.t('nav.results'), active, 'results')}
      <div class="sidebar-section">${i18n.t('nav.system')}</div>
      ${sidebarItem('/conversations.html', 'conversations', i18n.t('nav.conversations'), active, 'conversations')}
    </nav>
    <div class="sidebar-foot">
      <button type="button" id="themeBtn" onclick="window.hub.cycleTheme()" title="${i18n.t('theme.switch')}"></button>
      <button type="button" id="langBtn" onclick="window.hub.toggleLang()" title="${i18n.t('lang.switch')}"></button>
    </div>
  </aside>
  <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="window.hub.toggleSidebar(false)"></div>
  <button class="sidebar-toggle" aria-label="menu" onclick="window.hub.toggleSidebar()">${icon('menu', 17)}</button>`;
}

function toggleSidebar(force) {
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('sidebarBackdrop');
  if (!sb) return;
  const open = force !== undefined ? force : !sb.classList.contains('open');
  sb.classList.toggle('open', open);
  bd.classList.toggle('show', open);
}

/* ---------- 侧边栏未读角标（Inbox/Tasks/Approvals，随刷新更新） ---------- */
function setNavBadge(key, count) {
  const item = document.querySelector(`.sidebar-item[data-nav="${key}"]`);
  if (!item) return;
  let b = item.querySelector(`.sidebar-count[data-nav-badge="${key}"]`);
  if (count > 0) {
    const text = count > 99 ? '99+' : String(count);
    if (b) {
      b.textContent = text;
    } else {
      b = document.createElement('span');
      b.className = 'sidebar-count';
      b.setAttribute('data-nav-badge', key);
      b.textContent = text;
      item.appendChild(b);
    }
  } else if (b) {
    b.remove();
  }
}

async function updateNavBadges() {
  try {
    const [dash, att] = await Promise.all([
      api('GET', '/api/dashboard'),
      api('GET', '/api/attention'),
    ]);
    setNavBadge('inbox', dash.inbox || 0);
    setNavBadge('tasks', dash.candidates || 0);
    setNavBadge('approvals', att.count || 0);
  } catch (e) { /* badge refresh is best-effort */ }
}

/* ---------- 空态 / 骨架屏辅助 ---------- */
function emptyHtml(icName, title, desc) {
  return '<div class="empty"><div class="empty-icon">' + icon(icName, 20) + '</div>'
    + '<div class="empty-title">' + esc(title) + '</div>'
    + (desc ? '<div class="empty-desc">' + esc(desc) + '</div>' : '') + '</div>';
}

function emptyCenter(title) {
  return '<div class="empty-center">' + esc(title) + '</div>';
}

function skeletonList(n) {
  let h = '';
  const count = n || 3;
  for (let i = 0; i < count; i++) {
    h += '<div class="card"><div class="card-body">'
      + '<div class="sk sk-line" style="width:45%"></div>'
      + '<div class="sk sk-line"></div>'
      + '<div class="sk sk-line" style="width:70%"></div>'
      + '</div></div>';
  }
  return h;
}

/* ---------- 结果事实 chips（facts_json → 结构化展示；testsRun 为 null 自动隐藏） ---------- */
function factsHtml(facts) {
  if (!facts) return '';
  const rows = [];
  if (facts.testsRun) {
    const tr = facts.testsRun;
    const pass = String(tr.status).toLowerCase() === 'pass';
    rows.push('<span class="fact ' + (pass ? 'ok' : 'bad') + '">' + icon(pass ? 'checkCircle' : 'xCircle', 13)
      + 'Tests: ' + esc(tr.status)
      + (tr.total !== undefined ? ' (' + tr.total + ')' : '')
      + (tr.pass !== undefined ? ' pass ' + tr.pass : '')
      + (tr.fail !== undefined ? ' fail ' + tr.fail : '') + '</span>');
  }
  if (facts.diffStat) {
    const ds = facts.diffStat;
    rows.push('<span class="fact">' + i18n.t('conv.change') + ' ' + ds.files + ' ' + i18n.t('common.filesUnit') + ' +' + ds.additions + ' -' + ds.deletions + '</span>');
  }
  if (facts.changedFiles && facts.changedFiles.length) {
    rows.push('<span class="fact">' + i18n.t('common.files') + esc(facts.changedFiles.map((f) => f.path).join(', ').slice(0, 120)) + '</span>');
  }
  if (facts.commitHash) {
    rows.push('<span class="fact mono">commit ' + esc(String(facts.commitHash).slice(0, 12)) + '</span>');
  }
  return rows.length ? '<div class="d-flex flex-wrap gap-1">' + rows.join(' ') + '</div>' : '';
}

/* ---------- UI 状态保持（整页刷新后恢复滚动位置 / 面板滚动 / Tasks 桶） ---------- */
const UI_KEY = 'hub-ui';
function uiLoad() {
  try { const s = sessionStorage.getItem(UI_KEY); return s ? JSON.parse(s) : {}; } catch (e) { return {}; }
}
function uiSave(obj) {
  try { sessionStorage.setItem(UI_KEY, JSON.stringify(obj)); } catch (e) { /* ignore */ }
}
function uiPathKey() { return location.pathname + location.search; }
function saveUiValue(key, val) { const st = uiLoad(); st[key] = val; uiSave(st); }
function readUiValue(key) { return uiLoad()[key]; }
function captureScrollState() {
  const st = uiLoad();
  st[uiPathKey()] = {
    y: window.scrollY || 0,
    panels: Array.from(document.querySelectorAll('.panel-body')).map((p) => p.scrollTop),
  };
  uiSave(st);
}
function restoreScrollState() {
  const saved = uiLoad()[uiPathKey()];
  if (!saved) return;
  const y = saved.y || 0;
  const panels = saved.panels || [];
  let tries = 0;
  const attempt = () => {
    tries++;
    if (y > 0) window.scrollTo(0, y);
    const els = document.querySelectorAll('.panel-body');
    els.forEach((el, i) => { if (panels[i] !== undefined) el.scrollTop = panels[i]; });
    if (tries < 8) setTimeout(attempt, 140);
  };
  setTimeout(attempt, 150);
}

/* ---------- 时间显示（相对时间，悬停显完整时间） ---------- */
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return esc(iso);
  const abs = Math.abs(Date.now() - d.getTime());
  const min = Math.floor(abs / 60000);
  const pad = (x) => String(x).padStart(2, '0');
  if (min < 1) return i18n.t('time.justNow');
  if (min < 60) return i18n.t('time.minAgo').replace('{n}', min);
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return i18n.t('time.hourAgo').replace('{n}', hrs);
  const days = Math.floor(hrs / 24);
  if (days < 7) return i18n.t('time.dayAgo').replace('{n}', days);
  return (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

async function page(title, active, opts = {}) {
  document.getElementById('nav').innerHTML = await nav(active);
  renderThemeButton();
  renderLangButton();
  i18n.applyI18n();
  updateNavBadges();
  restoreScrollState();
  document.title = title;
  if (opts.noAutoReload) {
    setInterval(() => { updateNavBadges(); }, 15000);
    return;
  }
  setInterval(() => {
    const el = document.activeElement;
    const typing = el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    if (!typing && !document.body.classList.contains('modal-open')) location.reload();
  }, 15000);
}

/* ---------- toast 统一提示 ---------- */
function toast(type, title, msg) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const icEl = document.createElement('span');
  icEl.className = 'toast-icon';
  icEl.innerHTML = icon(type === 'ok' ? 'checkCircle' : type === 'err' ? 'alertCircle' : 'info', 15);
  el.appendChild(icEl);
  const txtEl = document.createElement('div');
  const titleEl = document.createElement('div');
  titleEl.className = 'toast-title';
  titleEl.textContent = title;
  txtEl.appendChild(titleEl);
  if (msg) {
    const msgEl = document.createElement('div');
    msgEl.className = 'toast-msg';
    msgEl.textContent = msg;
    txtEl.appendChild(msgEl);
  }
  el.appendChild(txtEl);
  const closeEl = document.createElement('button');
  closeEl.className = 'toast-close';
  closeEl.setAttribute('aria-label', 'close');
  closeEl.innerHTML = icon('x', 14);
  closeEl.onclick = () => el.remove();
  el.appendChild(closeEl);
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

/* ---------- 按钮加载态（防重复提交） ---------- */
async function withButton(btn, fn) {
  if (!btn) return fn();
  if (btn.disabled) return undefined;
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

/* ---------- 轻量模态（替代 prompt） ---------- */
function modalPrompt(opts) {
  const overlay = document.createElement('div');
  overlay.className = 'modal fade show d-block';
  overlay.style.background = 'var(--overlay)';
  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  const content = document.createElement('div');
  content.className = 'modal-content';
  const head = document.createElement('div');
  head.className = 'modal-header';
  const h5 = document.createElement('h5');
  h5.className = 'modal-title';
  h5.textContent = opts.title || '';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-ghost btn-sm';
  closeBtn.innerHTML = icon('x', 15);
  head.appendChild(h5);
  head.appendChild(closeBtn);
  const body = document.createElement('div');
  body.className = 'modal-body';
  const inputs = [];
  (opts.fields || []).forEach((f) => {
    const wrap = document.createElement('div');
    wrap.className = 'mb-2';
    if (f.label) {
      const lbl = document.createElement('label');
      lbl.className = 'form-label';
      lbl.textContent = f.label;
      wrap.appendChild(lbl);
    }
    let el;
    if (f.type === 'select') {
      el = document.createElement('select');
      el.className = 'form-select';
      (f.options || []).forEach((op) => {
        const o = document.createElement('option');
        const isObj = op !== null && typeof op === 'object';
        o.value = isObj ? op.value : op;
        o.textContent = isObj ? op.label : op;
        el.appendChild(o);
      });
      el.value = f.value !== undefined ? f.value : (f.options && f.options.length ? ((typeof f.options[0] === 'object' ? f.options[0].value : f.options[0]) || '') : '');
    } else if (f.type === 'textarea') {
      el = document.createElement('textarea');
      el.className = 'form-control';
      el.rows = 2;
      if (f.placeholder) el.setAttribute('placeholder', f.placeholder);
      el.value = f.value || '';
    } else {
      el = document.createElement('input');
      el.className = 'form-control';
      if (f.placeholder) el.setAttribute('placeholder', f.placeholder);
      el.value = f.value || '';
    }
    el.name = f.name;
    inputs.push(el);
    wrap.appendChild(el);
    body.appendChild(wrap);
  });
  const foot = document.createElement('div');
  foot.className = 'modal-footer';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = i18n.t('common.cancel');
  const okBtn = document.createElement('button');
  okBtn.className = 'btn ' + (opts.okClass || 'btn-primary');
  okBtn.textContent = opts.okText || i18n.t('common.confirm');
  foot.appendChild(cancelBtn);
  foot.appendChild(okBtn);
  content.appendChild(head);
  content.appendChild(body);
  content.appendChild(foot);
  dialog.appendChild(content);
  overlay.appendChild(dialog);

  const api = { open: true, overlay, okBtn, cancelBtn, inputs };
  api.values = () => {
    const v = {};
    inputs.forEach((el) => { v[el.name] = el.value; });
    return v;
  };
  api.close = () => {
    if (!api.open) return;
    api.open = false;
    overlay.remove();
  };
  let busy = false;
  api.submit = async () => {
    if (!api.open || busy) return;
    busy = true;
    okBtn.disabled = true;
    okBtn.classList.add('loading');
    try {
      const ret = opts.onOk ? await opts.onOk(api.values()) : undefined;
      api.close();
      return ret;
    } catch (e) {
      formError(e);
    } finally {
      busy = false;
      okBtn.disabled = false;
      okBtn.classList.remove('loading');
    }
  };
  okBtn.onclick = () => api.submit();
  cancelBtn.onclick = () => api.close();
  overlay.onclick = (e) => { if (e && e.target === overlay) api.close(); };
  document.body.appendChild(overlay);
  return api;
}

function formError(err) {
  const msg = err && err.message ? String(err.message) : String(err);
  const sep = msg.indexOf(':');
  const code = sep > 0 ? msg.slice(0, sep).trim() : '';
  if (code === 'VERSION_CONFLICT' || code === 'INVALID_TRANSITION' || code === 'DUPLICATE') {
    toast('err', i18n.t('toast.conflictTitle'), i18n.t('toast.conflictMsg'));
    setTimeout(() => location.reload(), 1200);
    return;
  }
  const body = sep > 0 ? msg.slice(sep + 1).trim() : msg;
  toast('err', i18n.t('toast.errorTitle'), body || msg);
}

const CAPS = [
  'read_project', 'write_project', 'run_project_commands', 'run_tests', 'install_dependencies',
  'network', 'git_commit', 'git_push', 'sudo', 'system_config', 'outside_project',
];

const SCENARIOS = ['SUCCESS', 'FAIL', 'WAIT_FOR_USER', 'WAIT_FOR_APPROVAL', 'TIMEOUT', 'CRASH_ONCE_THEN_SUCCESS'];

function grantEditor(containerId, initial) {
  const el = document.getElementById(containerId);
  el.innerHTML = CAPS.map((key) => {
    const v = initial && initial[key] ? initial[key] : 'ask';
    return `<div class="row mb-1">
      <div class="col-5"><label class="form-label mb-0 small">${i18n.t('cap.' + key)}</label></div>
      <div class="col-7">
        <select class="form-select form-select-sm grant-cap" data-cap="${key}">
          <option value="allow" ${v === 'allow' ? 'selected' : ''}>ALLOW</option>
          <option value="ask" ${v === 'ask' ? 'selected' : ''}>ASK</option>
          <option value="deny" ${v === 'deny' ? 'selected' : ''}>DENY</option>
        </select>
      </div>
    </div>`;
  }).join('');
}

function collectGrant(containerId) {
  const out = {};
  document.querySelectorAll(`#${containerId} .grant-cap`).forEach((sel) => {
    out[sel.dataset.cap] = sel.value;
  });
  return out;
}

async function openApproveModal(candidateId, title) {
  document.body.classList.add('modal-open');
  const html = `
  <div class="modal fade show d-block" tabindex="-1" style="background:var(--overlay)">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header"><h5 class="modal-title">${i18n.t('modal.approveTitle')} #${candidateId}</h5></div>
        <div class="modal-body">
          <div class="mb-2">
            <label class="form-label">${i18n.t('modal.taskTitle')}</label>
            <input class="form-control" id="approve-title" value="${esc(title)}">
          </div>
          <div class="mb-2 row">
            <div class="col-6">
              <label class="form-label">${i18n.t('modal.project')}</label>
              <select class="form-select" id="approve-project"></select>
            </div>
            <div class="col-6">
              <label class="form-label">${i18n.t('modal.worker')}</label>
              <select class="form-select" id="approve-worker">
                <option value="fake-worker">${i18n.t('modal.workerFake')}</option>
                <option value="codex">${i18n.t('modal.workerCodex')}</option>
                <option value="opencode">${i18n.t('modal.workerOpencode')}</option>
              </select>
            </div>
          </div>
          <div class="mb-2">
            <label class="form-label">${i18n.t('modal.grant')}</label>
            <div id="approve-grant"></div>
          </div>
          <details class="fold">
            <summary>${i18n.t('modal.advanced')}</summary>
            <div class="mt-2">
              <label class="form-label">${i18n.t('modal.scenario')}</label>
              <select class="form-select" id="approve-scenario">
                ${SCENARIOS.map((s) => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
          </details>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="approve-cancel">${i18n.t('common.cancel')}</button>
          <button class="btn btn-success" id="approve-ok">${i18n.t('modal.approveDispatch')}</button>
        </div>
      </div>
    </div>
  </div>`;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  document.body.appendChild(holder);
  grantEditor('approve-grant');
  const projects = await api('GET', '/api/projects').catch(() => []);
  const sel = holder.querySelector('#approve-project');
  sel.innerHTML = `<option value="">${i18n.t('modal.none')}</option>` + projects.map((p) => `<option value="${p.id}" data-type="${esc(p.project_type)}">${esc(p.name)}</option>`).join('');
  const workerSel = holder.querySelector('#approve-worker');
  sel.onchange = () => {
    const opt = sel.selectedOptions[0];
    if (opt && opt.dataset.type === 'SYSTEM_HUB' && workerSel.value === 'fake-worker') workerSel.value = 'codex';
  };
  holder.querySelector('#approve-cancel').onclick = () => { holder.remove(); document.body.classList.remove('modal-open'); };
  holder.querySelector('#approve-ok').onclick = async () => {
    const okBtn = holder.querySelector('#approve-ok');
    okBtn.disabled = true;
    okBtn.classList.add('loading');
    try {
      const body = {
        title: holder.querySelector('#approve-title').value || null,
        projectId: sel.value ? Number(sel.value) : null,
        scenario: holder.querySelector('#approve-scenario').value,
        worker: workerSel.value,
        grant: collectGrant('approve-grant'),
      };
      await api('POST', `/api/candidates/${candidateId}/approve`, body);
      holder.remove();
      document.body.classList.remove('modal-open');
      location.reload();
    } catch (e) {
      formError(e);
      okBtn.disabled = false;
      okBtn.classList.remove('loading');
    }
  };
}

function registerAutoReload() {
  page(document.title);
}

applyTheme();

window.addEventListener('beforeunload', () => { captureScrollState(); });

window.hub = { api, esc, badge, icon, typeChip, page, formError, toast, modalPrompt, withButton, grantEditor, collectGrant, openApproveModal, toggleSidebar, getTheme, cycleTheme, toggleLang, updateNavBadges, emptyHtml, emptyCenter, skeletonList, factsHtml, fmtTime, saveUiValue, readUiValue, CAPS, SCENARIOS, registerAutoReload };
