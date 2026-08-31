'use strict';

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

function badge(state) {
  const colors = {
    NEW: 'bg-info', READ: 'bg-secondary', IGNORED: 'bg-dark', ARCHIVED: 'bg-secondary', CONVERTED: 'bg-primary',
    OPEN: 'bg-secondary', EXECUTING: 'bg-primary', RESULT_AVAILABLE: 'bg-success', REVIEW: 'bg-warning',
    COMPLETED: 'bg-success', CANCELLED: 'bg-dark', PENDING: 'bg-warning', APPROVED: 'bg-success',
    REJECTED: 'bg-danger', EXPIRED: 'bg-dark', QUEUED: 'bg-secondary', RUNNING: 'bg-primary',
    WAITING_FOR_USER: 'bg-warning', WAITING_FOR_APPROVAL: 'bg-warning', FAILED: 'bg-danger',
    DISPATCHED: 'bg-success', DEAD: 'bg-danger', ACTIVE: 'bg-success', REVOKED: 'bg-dark',
    ANSWERED: 'bg-success', ALLOWED: 'bg-success', DENIED: 'bg-danger', ASKED_USER: 'bg-warning',
  };
  return `<span class="badge ${colors[state] || 'bg-secondary'}">${esc(state)}</span>`;
}

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

function sidebarItem(href, key, label, active) {
  return `<a class="sidebar-item ${active === key ? 'active' : ''}" data-nav="${key}" href="${href}">${label}</a>`;
}

async function nav(active) {
  const s = await loadNavState();
  const homeHref = s.globalConversationId ? `/conversation.html?id=${s.globalConversationId}` : '/conversations.html';
  const hubProjects = s.projects.filter((p) => p.project_type === 'SYSTEM_HUB');
  const userProjects = s.projects.filter((p) => p.project_type !== 'SYSTEM_HUB');
  const projectLink = (p, badgeHtml) =>
    sidebarItem(`/project.html?id=${p.id}`, 'projects', `${esc(p.name)} ${badgeHtml}`, active);
  return `
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-brand"><a href="/">Personal Hub</a></div>
    <nav class="sidebar-nav">
      <div class="sidebar-section">主界面</div>
      ${sidebarItem(homeHref, 'home', 'Home（个人助手）', active)}
      <div class="sidebar-section">项目</div>
      ${hubProjects.map((p) => projectLink(p, '<span class="sidebar-tag">系统</span>')).join('')}
      ${userProjects.map((p) => projectLink(p, '')).join('')}
      ${sidebarItem('/projects.html', 'projects-admin', '管理项目', active)}
      <div class="sidebar-section">工作台</div>
      ${sidebarItem('/inbox.html', 'inbox', 'Inbox', active)}
      ${sidebarItem('/tasks.html', 'tasks', 'Tasks', active)}
      ${sidebarItem('/approvals.html', 'approvals', 'Approvals', active)}
      ${sidebarItem('/executions.html', 'executions', 'Executions', active)}
      ${sidebarItem('/results.html', 'results', 'Results', active)}
      <div class="sidebar-section">系统</div>
      ${sidebarItem('/conversations.html', 'conversations', 'Conversations', active)}
    </nav>
  </aside>
  <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="window.hub.toggleSidebar(false)"></div>
  <button class="sidebar-toggle" aria-label="菜单" onclick="window.hub.toggleSidebar()">☰</button>`;
}

function toggleSidebar(force) {
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('sidebarBackdrop');
  const open = force !== undefined ? force : !sb.classList.contains('open');
  sb.classList.toggle('open', open);
  bd.classList.toggle('show', open);
}

async function page(title, active, opts = {}) {
  document.getElementById('nav').innerHTML = await nav(active);
  document.title = title;
  if (opts.noAutoReload) return;
  setInterval(() => {
    const el = document.activeElement;
    const typing = el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    if (!typing && !document.body.classList.contains('modal-open')) location.reload();
  }, 15000);
}

function formError(err) {
  alert(err.message || String(err));
}

const CAPS = [
  ['read_project', '读项目文件'],
  ['write_project', '写项目文件'],
  ['run_project_commands', '运行项目命令'],
  ['run_tests', '运行测试'],
  ['install_dependencies', '安装依赖'],
  ['network', '网络访问'],
  ['git_commit', 'Git 提交'],
  ['git_push', 'Git 推送'],
  ['sudo', 'sudo'],
  ['system_config', '系统配置'],
  ['outside_project', '项目外访问'],
];

const SCENARIOS = ['SUCCESS', 'FAIL', 'WAIT_FOR_USER', 'WAIT_FOR_APPROVAL', 'TIMEOUT', 'CRASH_ONCE_THEN_SUCCESS'];

function grantEditor(containerId, initial) {
  const el = document.getElementById(containerId);
  el.innerHTML = CAPS.map(([key, label]) => {
    const v = initial && initial[key] ? initial[key] : 'ask';
    return `<div class="row mb-1">
      <div class="col-5"><label class="form-label mb-0 small">${label}</label></div>
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
  <div class="modal fade show d-block" tabindex="-1" style="background:rgba(0,0,0,.5)">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header"><h5 class="modal-title">批准候选 #${candidateId}</h5></div>
        <div class="modal-body">
          <div class="mb-2">
            <label class="form-label">任务标题</label>
            <input class="form-control" id="approve-title" value="${esc(title)}">
          </div>
          <div class="mb-2 row">
            <div class="col-6">
              <label class="form-label">项目</label>
              <select class="form-select" id="approve-project"></select>
            </div>
            <div class="col-6">
              <label class="form-label">FakeWorker 场景</label>
              <select class="form-select" id="approve-scenario">
                ${SCENARIOS.map((s) => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="mb-2">
            <label class="form-label">Execution Grant（ALLOW / ASK / DENY）</label>
            <div id="approve-grant"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="approve-cancel">取消</button>
          <button class="btn btn-success" id="approve-ok">批准并派发</button>
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
  sel.innerHTML = '<option value="">（无）</option>' + projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  holder.querySelector('#approve-cancel').onclick = () => { holder.remove(); document.body.classList.remove('modal-open'); };
  holder.querySelector('#approve-ok').onclick = async () => {
    try {
      const body = {
        title: holder.querySelector('#approve-title').value || null,
        projectId: sel.value ? Number(sel.value) : null,
        scenario: holder.querySelector('#approve-scenario').value,
        grant: collectGrant('approve-grant'),
      };
      await api('POST', `/api/candidates/${candidateId}/approve`, body);
      holder.remove();
      document.body.classList.remove('modal-open');
      location.reload();
    } catch (e) { formError(e); }
  };
}

function registerAutoReload() {
  page(document.title);
}

window.hub = { api, esc, badge, page, formError, grantEditor, collectGrant, openApproveModal, toggleSidebar, CAPS, SCENARIOS, registerAutoReload };
