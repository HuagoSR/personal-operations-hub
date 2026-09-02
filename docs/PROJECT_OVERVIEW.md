# 项目总览（PROJECT_OVERVIEW）

## 这个项目是什么

一个长期运行的 **Personal Operations Hub（个人工作/信息枢纽 Agent）**：持续接收外界信息，理解哪些信息与用户有关，整理、归纳、形成事件和潜在任务；必要时主动通知用户；对于可以在服务器上执行的任务，在获得用户明确批准后交给专业 Coding Agent（Codex / OpenCode）执行。Hub 负责协调、追踪、询问、汇报，不亲自承担复杂编程工作。

可以理解为：秘书 + 个人信息中心 + 项目经理 + Agent 调度器。

## 为什么做

- 把分散的信息源（群消息、邮件、代码仓库事件等）汇聚成统一的、经过理解的事件流；
- 把"看到信息 → 判断 → 决策 → 执行 → 汇报"的日常负担从用户转移给长期运行的 Agent；
- 让专业的 Coding Agent 做专业的事，而不是让一个万能 Agent 什么都做。

## 最终目标

- 长期稳定运行的 Hub：持续采集 → 理解 → 关联 → 形成事件与任务候选；
- 可信的审批与授权体系：任何执行都经过用户明确批准和权限边界约束；
- 独立的 Trusted Control Channel（第一版 Web 已上线；PWA + Push 仍为远期）：对话、查看 Inbox、审批任务、回答 Worker 问题、查看结果；
- 可扩展的信息源体系（微信 → Email/GitHub/Calendar/RSS…）。

## 当前做到哪里（截至 2026-09-02）

| 组件 | 状态 |
|---|---|
| 微信 Gateway（只读采集） | ✅ 运行中（systemd --user）；7 天 soak 完成 |
| Hub V0.1 | ✅ 完成：SQLite 状态机 + Outbox + FakeWorker + spool 摄入 + Control Web（tag `v0.1-known-good`） |
| Real Worker Foundation | ✅ 完成（Codex 线全绿：bwrap Enforcement 8/8、权限链、真实修复任务；OpenCode 上游回归待解锁） |
| Controlled Pilot（Gomoku） | ✅ 完成：10 PASS + 2 PASS_WITH_NOTES，结论 READY_FOR_REAL_PROJECT_READ_ONLY |
| Control Web 重构与 UX 打磨（6A–6F） | ✅ 上线：6A–6D 数据基础、侧边栏导航、Conversation-first 时间线、全局运维视图（Tasks 分桶、Approvals 三区聚合面板、Dashboard 活动流）；6F 打磨：亮暗主题（跟随系统）、中英双语切换、md-lite Markdown 渲染、toast/模态、按钮加载态、侧边栏未读角标、空态/骨架屏、时间线智能刷新、相对时间戳。108 测试全绿 |
| Hub Self 开发闭环（6E） | ✅ 完成：Safe Self-Modification Pilot 全闭环（hub-dev 隔离副本 → Codex 修改/测试/commit → Result facts（commit hash）→ Prepare Update → 手动 apply → 回滚演练 → 再 apply） |
| 移动端响应式 | ⏸ 暂缓（用户决定，后续按需启用） |
| 通知 / 智能管线 / 多源 | ❌ 未开发（后续评估） |

历史与调研：`research/`（GATEWAY_HISTORY / ARCHITECTURE_RESEARCH / HUB_V01_REPORT / worker-control-interfaces / human-approval-patterns / PHASE4_* / PHASE5_* / PHASE6_*）。

## 什么明确不是目标

- 不是微信机器人（微信**永久只读**，永不发送）；
- 不是万能编程 Agent（Hub 不替代 Codex/OpenCode，只调度它们）；
- 不是即时执行系统（外部消息不能直接触发服务器操作）；
- 当前阶段不做：LLM 智能管线、移动原生 App、通知系统/Push、PWA、多信息源（后续评估）；移动端响应式暂缓；Worker 只准操作沙箱隔离工作区（含 Hub Self 开发副本）。
