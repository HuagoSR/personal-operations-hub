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
- 独立的 Trusted Control Channel（第一版 Web/PWA + Push）：对话、查看 Inbox、审批任务、回答 Worker 问题、查看结果；
- 可扩展的信息源体系（微信 → Email/GitHub/Calendar/RSS…）。

## 当前做到哪里（截至 2026-08-28）

| 组件 | 状态 |
|---|---|
| 微信 Gateway（只读采集） | ✅ 运行中（systemd --user）；7 天 soak 测试进行中 |
| Hub V0.1 | ✅ 完成：SQLite 状态机 + Outbox + FakeWorker + spool 摄入 + Control Web；26 测试 PASS + 24h 自测 PASS（tag `v0.1-known-good`） |
| Phase 4 Real Worker Foundation | 🔄 进行中：OpenCode/Codex 运行时验证 → Enforcement Gate → AgentWorker → 双 Worker → WorkerManager（见 `research/PHASE4_PLAN.md`） |
| Control Channel | ✅ Web 最小版；PWA+Push 未做（Phase 8） |
| 通知 / 智能管线 / 多源 | ❌ 未开发（Phase 7/8/9） |

历史与调研：`research/`（GATEWAY_HISTORY / ARCHITECTURE_RESEARCH / HUB_V01_REPORT / worker-control-interfaces / human-approval-patterns / PHASE4_PLAN / soak 日报）。

## 什么明确不是目标

- 不是微信机器人（微信**永久只读**，永不发送）；
- 不是万能编程 Agent（Hub 不替代 Codex/OpenCode，只调度它们）；
- 不是即时执行系统（外部消息不能直接触发服务器操作）；
- 当前阶段不做：LLM 智能管线、移动原生 App、通知系统/Push、PWA、多信息源（Phase 7/8/9）；Phase 4 内 Worker 只准操作 sandbox 测试项目。
