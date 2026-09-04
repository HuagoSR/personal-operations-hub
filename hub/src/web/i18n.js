/*!
 * i18n: bilingual dictionary and helpers for Personal Hub control web.
 * Default language: zh. Persisted in localStorage 'hub-lang'.
 * '?lang=zh|en' URL param overrides once and persists (useful for testing).
 * Switching language reloads the page so all JS-rendered content re-renders.
 * Rules: proper nouns (Hub, Worker, Codex, Git, commit, Diff, Outbox, apply)
 * stay in English in zh mode; user data (titles, message bodies, errors,
 * timestamps) is never translated.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.i18n = api; root.t = api.t; }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var LANG_KEY = 'hub-lang';

  var DICT = {
    zh: {
      'nav.main': '主界面', 'nav.projects': '项目', 'nav.workspace': '工作台', 'nav.system': '系统',
      'nav.home': '主页（个人助手）', 'nav.inbox': '收件箱', 'nav.tasks': '任务', 'nav.approvals': '审批',
      'nav.executions': '执行', 'nav.results': '结果', 'nav.conversations': '会话',
      'nav.manageProjects': '项目管理', 'nav.tagSystem': '系统',

      'title.dashboard': '概览', 'title.inbox': '收件箱', 'title.tasks': '任务', 'title.approvals': '审批',
      'title.executions': '执行记录', 'title.results': '结果审查', 'title.projects': '项目管理',
      'title.project': '项目详情', 'title.conversations': '会话', 'title.conversation': '对话',

      'theme.auto': '跟随系统', 'theme.light': '浅色', 'theme.dark': '深色', 'theme.switch': '切换主题',
      'lang.switch': '切换语言',

      'type.task': '任务', 'type.execution': '执行', 'type.result': '结果', 'type.approval': '审批',
      'type.apply': 'Hub 更新', 'type.perm': '权限请求', 'type.question': 'Worker 提问',

      'common.approve': '批准', 'common.reject': '拒绝', 'common.allow': '允许', 'common.deny': '拒绝',
      'common.cancel': '取消', 'common.cancelTask': '取消任务', 'common.reply': '回答',
      'common.rerun': '再次执行', 'common.complete': '确认完成', 'common.done': '已完成',
      'common.confirm': '确认',
      'common.viewResults': '查看结果', 'common.viewContext': '查看上下文', 'common.createTask': '创建任务',
      'common.ignore': '忽略', 'common.archive': '归档', 'common.create': '创建',
      'common.highRisk': '高风险', 'common.answerPh': '回答', 'common.latestExec': '最新执行',
      'common.taskWord': '任务', 'common.execWord': '执行', 'common.resultWord': '结果',
      'common.candidate': '候选', 'common.you': '你', 'common.filesUnit': '个文件', 'common.files': '文件: ',
      'common.viewDiff': '查看 Diff', 'common.prepareUpdate': '准备更新', 'common.conversation': '会话',
      'common.send': '发送', 'common.confirm': '确认',

      'toast.errorTitle': '操作失败', 'toast.errorHint': '请重试；若持续失败请联系开发者',
      'toast.conflictTitle': '内容已更新', 'toast.conflictMsg': '状态已变化，正在刷新页面…',

      'time.justNow': '刚刚', 'time.minAgo': '{n} 分钟前', 'time.hourAgo': '{n} 小时前', 'time.dayAgo': '{n} 天前',

      'dash.stats.inbox': '收件箱新事件', 'dash.stats.candidates': '任务候选',
      'dash.stats.attention': '未处理事项', 'dash.stats.approvals': '待审批',
      'dash.stats.running': '运行中执行', 'dash.stats.waiting': '等待用户',
      'dash.stats.results': '结果待审', 'dash.stats.completed': '已完成任务',
      'dash.stats.outbox': 'Outbox 待处理', 'dash.stats.dead': 'Outbox 死信',
      'dash.projectActivity': '项目活动', 'dash.recent': '最近活动', 'dash.projectsTitle': '项目',
      'dash.countsGlobal': '全局（无项目）', 'dash.countsNone': '无任务',
      'dash.noProjects': '暂无项目', 'dash.noActivity': '暂无活动',
      'dash.globalHub': '进入个人助手会话', 'dash.globalHubFallback': '进入会话列表（含 Global Hub）',
      'dash.devDetails': '开发者详情（内部调试）',
      'dash.outboxPending': 'Outbox：待处理', 'dash.outboxDead': 'Dead',

      'inbox.empty': '暂无 Inbox 条目（@提及或私聊消息会出现在这里）',
      'inbox.mentioned': '@提及', 'inbox.titlePrompt': '任务标题（可留空使用默认）',
      'common.save': '保存',

      'intl.analysis': 'Hub 智能分析', 'intl.noAnalysis': '暂无智能分析',
      'intl.importance': '重要性', 'intl.urgency': '紧迫性',
      'intl.actionYes': '需行动', 'intl.actionNo': '仅信息',
      'intl.confidence': '置信度', 'intl.summary': '摘要',
      'intl.project': '建议项目', 'intl.task': '建议任务',
      'intl.accepted': '分析正确', 'intl.rejected': '不是任务',
      'intl.modify': '修改分类', 'intl.adjust': '修改重要性/紧迫性/项目',
      'intl.feedbackDone': '已反馈', 'intl.risk': '风险标记',
      'intl.failed': '分析失败', 'intl.failedNote': '失败原因',
      'intl.viewRaw': '查看原始 JSON', 'intl.correctedTo': '修正为',
      'intl.low': '低', 'intl.medium': '中', 'intl.high': '高',
      'intl.level': '等级', 'intl.keep': '保持不变',

      'tasks.candidates': '任务候选', 'tasks.sectionTasks': '任务',
      'tasks.bucket.running': '进行中', 'tasks.bucket.waiting': '等我处理',
      'tasks.bucket.results': '结果待审', 'tasks.bucket.failed': '失败',
      'tasks.bucket.completed': '已完成', 'tasks.bucket.cancelled': '已取消',
      'tasks.empty.running': '暂无进行中的任务', 'tasks.empty.waiting': '没有等待你处理的任务',
      'tasks.empty.results': '暂无待审结果', 'tasks.empty.failed': '暂无失败任务',
      'tasks.empty.completed': '暂无已完成任务', 'tasks.empty.cancelled': '暂无已取消任务',
      'tasks.noCandidates': '暂无任务候选。可在 Inbox 或会话中创建',
      'tasks.rejectPh': '拒绝原因（可留空）',
      'tasks.scenarioPrompt': '场景（SUCCESS/FAIL/WAIT_FOR_USER/WAIT_FOR_APPROVAL/TIMEOUT/CRASH_ONCE_THEN_SUCCESS）',
      'tasks.scenarioShort': '场景',

      'appr.desc': '需要你关注的事项：任务批准 / 权限请求 / Worker 提问（与全局 Approvals 页同实体、幂等）',
      'appr.countText': '{n} 项需要你的关注',
      'appr.taskApprovals': '任务批准', 'appr.permissions': '权限请求',
      'appr.questions': 'Worker 提问', 'appr.applyRequests': '部署待办（Hub Self Update）',
      'appr.empty.candidates': '暂无待批准的任务候选',
      'appr.empty.permissions': '暂无等待裁决的权限请求',
      'appr.empty.questions': '暂无等待回答的 Worker 提问',
      'appr.empty.apply': '暂无待部署的 Hub Update',
      'appr.expiresAt': '过期于',
      'appr.applyHintManual': '手动 apply（不依赖 Hub）：',
      'appr.applyHintRollback': '；回滚：',

      'exec.empty': '暂无执行记录',

      'res.empty': '暂无结果', 'res.tests': '测试：', 'res.artifacts': '产物：', 'res.evidence': '证据：',

      'proj.namePh': '名称', 'proj.descPh': '描述', 'proj.workspacePh': 'workspace 路径（仅登记）',
      'proj.create': '创建项目', 'proj.systemProjects': '系统项目', 'proj.myProjects': '我的项目',
      'proj.systemTag': '系统项目（不可删除）', 'proj.tagSystemFull': '系统项目',
      'proj.noSystem': '无系统项目', 'proj.noProjects': '暂无项目',
      'proj.workspaceNote': '仅登记元数据，Hub 不访问',
      'proj.conversations': '会话', 'proj.tasksTitle': '任务', 'proj.events': '审计事件（审计视图）',
      'proj.newConversation': '+ 新建会话', 'proj.convTitlePh': '新会话标题',
      'proj.createConversation': '创建会话', 'proj.defaultTag': '默认',
      'proj.noConversations': '暂无会话', 'proj.noTasks': '暂无任务', 'proj.noEvents': '暂无事件',

      'conv.placeholder': '输入指令（Enter 发送生成任务候选；Shift+Enter 换行）',
      'conv.recordOnly': '仅记录为消息（不生成任务候选）',
      'conv.empty': '暂无消息。用下方输入框给 Hub 下达指令。',
      'conv.missingId': '缺少会话 id', 'conv.change': '变更',
      'conv.waitingApproval': '等待批准', 'conv.notApplied': '部署状态：未应用',
      'conv.sourceCommit': '源提交', 'conv.base': '基',
      'conv.applyHint': '在 VPS 上手动执行 apply（不依赖 Hub）：',
      'conv.projectLink': '所属项目',

      'modal.approveTitle': '批准候选', 'modal.taskTitle': '任务标题', 'modal.project': '项目',
      'modal.worker': 'Worker', 'modal.grant': 'Execution Grant（ALLOW / ASK / DENY）',
      'modal.none': '（无）', 'modal.scenario': 'FakeWorker 场景',
      'modal.approveDispatch': '批准并派发',
      'modal.workerFake': 'fake-worker（模拟）', 'modal.workerCodex': 'codex（真实）',
      'modal.workerOpencode': 'opencode（真实）',
      'modal.rejectTitle': '拒绝候选', 'modal.chooseScenario': '选择场景',
      'modal.advanced': '高级选项（调试）',

      'cap.read_project': '读项目文件', 'cap.write_project': '写项目文件',
      'cap.run_project_commands': '运行项目命令', 'cap.run_tests': '运行测试',
      'cap.install_dependencies': '安装依赖', 'cap.network': '网络访问',
      'cap.git_commit': 'Git 提交', 'cap.git_push': 'Git 推送',
      'cap.sudo': 'sudo', 'cap.system_config': '系统配置', 'cap.outside_project': '项目外访问',
    },
    en: {
      'nav.main': 'Main', 'nav.projects': 'Projects', 'nav.workspace': 'Workspace', 'nav.system': 'System',
      'nav.home': 'Home (assistant)', 'nav.inbox': 'Inbox', 'nav.tasks': 'Tasks', 'nav.approvals': 'Approvals',
      'nav.executions': 'Executions', 'nav.results': 'Results', 'nav.conversations': 'Conversations',
      'nav.manageProjects': 'Manage projects', 'nav.tagSystem': 'System',

      'title.dashboard': 'Dashboard', 'title.inbox': 'Inbox', 'title.tasks': 'Tasks', 'title.approvals': 'Approvals',
      'title.executions': 'Executions', 'title.results': 'Result review', 'title.projects': 'Projects',
      'title.project': 'Project', 'title.conversations': 'Conversations', 'title.conversation': 'Conversation',

      'theme.auto': 'System', 'theme.light': 'Light', 'theme.dark': 'Dark', 'theme.switch': 'Toggle theme',
      'lang.switch': 'Toggle language',

      'type.task': 'Task', 'type.execution': 'Execution', 'type.result': 'Result', 'type.approval': 'Approval',
      'type.apply': 'Hub Update', 'type.perm': 'Permission request', 'type.question': 'Worker question',

      'common.approve': 'Approve', 'common.reject': 'Reject', 'common.allow': 'Allow', 'common.deny': 'Deny',
      'common.cancel': 'Cancel', 'common.cancelTask': 'Cancel task', 'common.reply': 'Answer',
      'common.rerun': 'Run again', 'common.complete': 'Mark complete', 'common.done': 'Completed',
      'common.viewResults': 'View results', 'common.viewContext': 'View context', 'common.createTask': 'Create task',
      'common.ignore': 'Ignore', 'common.archive': 'Archive', 'common.create': 'Create',
      'common.highRisk': 'High risk', 'common.answerPh': 'Answer', 'common.latestExec': 'Latest',
      'common.taskWord': 'Task', 'common.execWord': 'Execution', 'common.resultWord': 'Result',
      'common.candidate': 'Candidate', 'common.you': 'You', 'common.filesUnit': 'files', 'common.files': 'Files: ',
      'common.viewDiff': 'View diff', 'common.prepareUpdate': 'Prepare update', 'common.conversation': 'Conversation',
      'common.send': 'Send', 'common.confirm': 'Confirm',

      'toast.errorTitle': 'Action failed', 'toast.errorHint': 'Please retry; contact the developer if it keeps failing',
      'toast.conflictTitle': 'Content changed', 'toast.conflictMsg': 'State has changed — refreshing the page…',

      'time.justNow': 'just now', 'time.minAgo': '{n} min ago', 'time.hourAgo': '{n} h ago', 'time.dayAgo': '{n} d ago',

      'dash.stats.inbox': 'New inbox items', 'dash.stats.candidates': 'Task candidates',
      'dash.stats.attention': 'Needs attention', 'dash.stats.approvals': 'Pending approvals',
      'dash.stats.running': 'Running executions', 'dash.stats.waiting': 'Waiting for you',
      'dash.stats.results': 'Results to review', 'dash.stats.completed': 'Completed tasks',
      'dash.stats.outbox': 'Outbox pending', 'dash.stats.dead': 'Outbox dead',
      'dash.projectActivity': 'Project activity', 'dash.recent': 'Recent activity', 'dash.projectsTitle': 'Projects',
      'dash.countsGlobal': 'Global (no project)', 'dash.countsNone': 'No tasks',
      'dash.noProjects': 'No projects', 'dash.noActivity': 'No activity',
      'dash.globalHub': 'Open assistant conversation', 'dash.globalHubFallback': 'Open conversations',
      'dash.devDetails': 'Developer details (debug)',
      'dash.outboxPending': 'Outbox pending:', 'dash.outboxDead': 'Dead',

      'inbox.empty': 'Inbox is empty — mentions and DMs will appear here',
      'inbox.mentioned': 'Mentioned', 'inbox.titlePrompt': 'Task title (optional, default if empty)',
      'common.save': 'Save',

      'intl.analysis': 'Hub intelligence', 'intl.noAnalysis': 'No analysis yet',
      'intl.importance': 'Importance', 'intl.urgency': 'Urgency',
      'intl.actionYes': 'Needs action', 'intl.actionNo': 'Informational',
      'intl.confidence': 'Confidence', 'intl.summary': 'Summary',
      'intl.project': 'Suggested project', 'intl.task': 'Suggested task',
      'intl.accepted': 'Correct', 'intl.rejected': 'Not a task',
      'intl.modify': 'Adjust rating', 'intl.adjust': 'Adjust importance/urgency/project',
      'intl.feedbackDone': 'Feedback recorded', 'intl.risk': 'Risk flags',
      'intl.failed': 'Analysis failed', 'intl.failedNote': 'Reason',
      'intl.viewRaw': 'View raw JSON', 'intl.correctedTo': 'Corrected to',
      'intl.low': 'Low', 'intl.medium': 'Medium', 'intl.high': 'High',
      'intl.level': 'Level', 'intl.keep': 'Keep as-is',

      'tasks.candidates': 'Task candidates', 'tasks.sectionTasks': 'Tasks',
      'tasks.bucket.running': 'In progress', 'tasks.bucket.waiting': 'Waiting for me',
      'tasks.bucket.results': 'To review', 'tasks.bucket.failed': 'Failed',
      'tasks.bucket.completed': 'Completed', 'tasks.bucket.cancelled': 'Cancelled',
      'tasks.empty.running': 'No tasks in progress', 'tasks.empty.waiting': 'Nothing waiting for you',
      'tasks.empty.results': 'No results to review', 'tasks.empty.failed': 'No failed tasks',
      'tasks.empty.completed': 'No completed tasks', 'tasks.empty.cancelled': 'No cancelled tasks',
      'tasks.noCandidates': 'No candidates yet — create one from Inbox or a conversation',
      'tasks.rejectPh': 'Reject reason (optional)',
      'tasks.scenarioPrompt': 'Scenario (SUCCESS/FAIL/WAIT_FOR_USER/WAIT_FOR_APPROVAL/TIMEOUT/CRASH_ONCE_THEN_SUCCESS)',
      'tasks.scenarioShort': 'Scenario',

      'appr.desc': 'Items waiting on you: task approvals / permission requests / worker questions (same entities as the global pages, idempotent)',
      'appr.countText': '{n} items need your attention',
      'appr.taskApprovals': 'Task approvals', 'appr.permissions': 'Permission requests',
      'appr.questions': 'Worker questions', 'appr.applyRequests': 'Deployment (Hub Self Update)',
      'appr.empty.candidates': 'No candidates awaiting approval',
      'appr.empty.permissions': 'No permission requests awaiting decision',
      'appr.empty.questions': 'No worker questions awaiting answer',
      'appr.empty.apply': 'No Hub updates awaiting deployment',
      'appr.expiresAt': 'Expires',
      'appr.applyHintManual': 'Manual apply (out-of-band): ',
      'appr.applyHintRollback': '; rollback: ',

      'exec.empty': 'No executions yet',

      'res.empty': 'No results yet', 'res.tests': 'Tests:', 'res.artifacts': 'Artifacts:', 'res.evidence': 'Evidence:',

      'proj.namePh': 'Name', 'proj.descPh': 'Description', 'proj.workspacePh': 'Workspace path (registry only)',
      'proj.create': 'Create project', 'proj.systemProjects': 'System projects', 'proj.myProjects': 'My projects',
      'proj.systemTag': 'System (non-deletable)', 'proj.tagSystemFull': 'System project',
      'proj.noSystem': 'No system projects', 'proj.noProjects': 'No projects yet',
      'proj.workspaceNote': 'Registry only — Hub never accesses it',
      'proj.conversations': 'Conversations', 'proj.tasksTitle': 'Tasks', 'proj.events': 'Events (audit view)',
      'proj.newConversation': '+ New conversation', 'proj.convTitlePh': 'New conversation title',
      'proj.createConversation': 'Create conversation', 'proj.defaultTag': 'Default',
      'proj.noConversations': 'No conversations', 'proj.noTasks': 'No tasks', 'proj.noEvents': 'No events',

      'conv.placeholder': 'Type a command (Enter to send and create a task candidate; Shift+Enter for newline)',
      'conv.recordOnly': 'Log as message only (no task candidate)',
      'conv.empty': 'No messages yet — type a command below.',
      'conv.missingId': 'Missing conversation id', 'conv.change': 'Changed',
      'conv.waitingApproval': 'Awaiting approval', 'conv.notApplied': 'Deployment: not applied',
      'conv.sourceCommit': 'Source commit', 'conv.base': 'base',
      'conv.applyHint': 'Run apply manually on the VPS (out-of-band): ',
      'conv.projectLink': 'Project',

      'modal.approveTitle': 'Approve candidate', 'modal.taskTitle': 'Task title', 'modal.project': 'Project',
      'modal.worker': 'Worker', 'modal.grant': 'Execution grant (ALLOW / ASK / DENY)',
      'modal.none': '(none)', 'modal.scenario': 'FakeWorker scenario',
      'modal.approveDispatch': 'Approve & dispatch',
      'modal.workerFake': 'fake-worker (simulated)', 'modal.workerCodex': 'codex (real)',
      'modal.workerOpencode': 'opencode (real)',
      'modal.rejectTitle': 'Reject candidate', 'modal.chooseScenario': 'Choose scenario',
      'modal.advanced': 'Advanced (debug)',

      'cap.read_project': 'Read project files', 'cap.write_project': 'Write project files',
      'cap.run_project_commands': 'Run project commands', 'cap.run_tests': 'Run tests',
      'cap.install_dependencies': 'Install dependencies', 'cap.network': 'Network access',
      'cap.git_commit': 'Git commit', 'cap.git_push': 'Git push',
      'cap.sudo': 'sudo', 'cap.system_config': 'System config', 'cap.outside_project': 'Outside project access',
    },
  };

  var STATUS_ZH = {
    NEW: '未读', READ: '已读', IGNORED: '已忽略', ARCHIVED: '已归档', CONVERTED: '已转任务',
    OPEN: '待执行', EXECUTING: '执行中', RESULT_AVAILABLE: '结果待审', REVIEW: '审阅中',
    COMPLETED: '已完成', CANCELLED: '已取消',
    PENDING: '待批准', APPROVED: '已批准', REJECTED: '已拒绝', EXPIRED: '已过期',
    QUEUED: '排队中', DISPATCHED: '已派发', RUNNING: '运行中',
    WAITING_FOR_USER: '等待用户', WAITING_FOR_APPROVAL: '等待批准', FAILED: '失败',
    DEAD: '死信', ACTIVE: '生效中', REVOKED: '已吊销',
    ALLOWED: '已允许', DENIED: '已拒绝', ANSWERED: '已回答', ASKED_USER: '已转人工',
    PREPARED: '已就绪', APPLIED: '已应用', ROLLED_BACK: '已回滚', SUPERSEDED: '已作废',
  };
  var STATUS_EN = {
    NEW: 'New', READ: 'Read', IGNORED: 'Ignored', ARCHIVED: 'Archived', CONVERTED: 'Converted',
    OPEN: 'Open', EXECUTING: 'Executing', RESULT_AVAILABLE: 'Result available', REVIEW: 'In review',
    COMPLETED: 'Completed', CANCELLED: 'Cancelled',
    PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', EXPIRED: 'Expired',
    QUEUED: 'Queued', DISPATCHED: 'Dispatched', RUNNING: 'Running',
    WAITING_FOR_USER: 'Waiting for user', WAITING_FOR_APPROVAL: 'Waiting for approval', FAILED: 'Failed',
    DEAD: 'Dead', ACTIVE: 'Active', REVOKED: 'Revoked',
    ALLOWED: 'Allowed', DENIED: 'Denied', ANSWERED: 'Answered', ASKED_USER: 'Asked user',
    PREPARED: 'Prepared', APPLIED: 'Applied', ROLLED_BACK: 'Rolled back', SUPERSEDED: 'Superseded',
  };

  function getLang() {
    try {
      var v = root.localStorage && root.localStorage.getItem(LANG_KEY);
      return v === 'en' ? 'en' : 'zh';
    } catch (e) { return 'zh'; }
  }

  function persist(lang) {
    try { if (root.localStorage) root.localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignore */ }
  }

  /* '?lang=zh|en' overrides once and persists (head snippet mirrors this before CSS paint) */
  function initFromUrl() {
    try {
      if (!root.location || !root.location.search) return;
      var m = root.location.search.match(/[?&]lang=(zh|en)\b/);
      if (m) persist(m[1]);
    } catch (e) { /* ignore */ }
  }

  function t(key) {
    var lang = getLang();
    var d = DICT[lang] || DICT.zh;
    var v = d[key] !== undefined ? d[key] : (DICT.zh[key] !== undefined ? DICT.zh[key] : key);
    return v;
  }

  function statusLabel(state) {
    var m = getLang() === 'en' ? STATUS_EN : STATUS_ZH;
    return m[state] || state;
  }

  function applyI18n() {
    if (!root.document) return;
    document.documentElement.lang = getLang() === 'en' ? 'en' : 'zh-CN';
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) els[i].innerHTML = t(els[i].getAttribute('data-i18n'));
    els = document.querySelectorAll('[data-i18n-ph]');
    for (var j = 0; j < els.length; j++) els[j].setAttribute('placeholder', t(els[j].getAttribute('data-i18n-ph')));
    els = document.querySelectorAll('[data-i18n-title]');
    for (var k = 0; k < els.length; k++) els[k].setAttribute('title', t(els[k].getAttribute('data-i18n-title')));
  }

  function setLang(lang) {
    if (lang !== 'zh' && lang !== 'en') lang = 'zh';
    persist(lang);
    if (root.location) root.location.reload();
  }

  initFromUrl();

  return { t: t, getLang: getLang, setLang: setLang, statusLabel: statusLabel, applyI18n: applyI18n, DICT: DICT, STATUS_ZH: STATUS_ZH, STATUS_EN: STATUS_EN };
});
