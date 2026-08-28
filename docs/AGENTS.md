# AGENTS.md — Personal Operations Hub

## Project

长期运行的个人工作/信息枢纽 Agent：持续接收外部信息（首个信息源为普通微信群，永久只读），理解与用户相关的内容，整理为事件与潜在任务，经用户批准后把工程任务交给专业 Coding Agent（Codex / OpenCode）执行。Hub 本身负责协调、追踪、询问、汇报，不亲自承担复杂编程工作。

## Current Status

- **微信 Gateway**（已完成，7 天稳定性测试进行中）：官方 Linux 微信（容器）→ agent-wechat → 微信本地数据库只读读取 → Gateway V0.1 collector，systemd --user 托管。历史见 `research/GATEWAY_HISTORY.md`。
- **Hub V0.1**（已完成）：自研状态机 + SQLite（node:sqlite）+ 事务 Outbox + 幂等 Dispatcher + FakeWorker + spool 只读摄入 + Control Web（127.0.0.1:8300，systemd --user `personal-hub`）。26 测试 PASS + 24h 自测 PASS，tag `v0.1-known-good`。见 `research/HUB_V01_REPORT.md`。
- **Phase 4 Real Worker Foundation**（进行中，接近完成）：CodexWorker 端到端闭环已跑通（bwrap Enforcement 8/8、真实修复任务、权限 ALLOW/ASK 链）；OpenCodeWorker 适配器就绪但被上游 models.dev 目录回归阻断。报告：`research/PHASE4_PLAN.md` + `PHASE4_REPORT_*`。
- 无 LLM 智能管线、无通知系统（Phase 7/8 之后）。

## Architecture Principles

1. 微信是 **Untrusted Read-Only Information Source**，永久只读，永远不是控制渠道。
2. Hub 与 Coding Worker 严格分离：Hub=控制面（审批/调度/转发/审计），Worker=执行面（读码/改码/测试/执行）。
3. 外部消息只能形成 Information / Task Candidate，绝不能直接触发服务器执行。
4. Hub 默认不拥有 arbitrary shell；文件与 shell 能力属于 Worker，且必须经过 Execution Grant + Enforcement。
5. 数据流保持来源链：RawMessage → Event → TaskCandidate → Approval → Task → Execution → Result，每步可追溯。
6. Task 与 Execution 分离；Worker Session 是长生命周期的（可能 WAITING_FOR_USER 后继续）。
7. 核心数据模型围绕 Event/Task 构建，不与微信强耦合（未来可接入 Email/GitHub/Calendar/RSS）。

## Safety Boundaries

- **禁止**调用任何微信发送/open/logout 接口；Gateway 对 agent-wechat 只发 GET。静态检查脚本：`gateway/scripts/check-readonly.sh`。
- 微信消息（即使 @ 当前账号、来自熟人）一律视为不可信输入。
- 任何任务执行前必须获得用户批准及明确权限边界（Execution Grant），包括：读写范围、命令、网络、git push、sudo 等。
- 秘密数据（token、微信 DB key、完整 wxid、二维码、聊天原文）不得进入 Git、不得打印到日志；日志中的 chat/sender id 使用 sha256 前 8 位。
- 不修改宿主机 SSH/防火墙/systemd 系统级配置（除非用户明确批准）。
- 端口只绑定 127.0.0.1；远程访问走 SSH Tunnel。

## Repository Structure

```
~ (项目根，VPS: ~/wechat-linux-research/；GitHub: HuagoSR/personal-operations-hub)
├── AGENTS.md           本文件
├── docs/               项目正式文档（PROJECT_OVERVIEW/ARCHITECTURE/SECURITY_MODEL/DECISIONS/RELIABILITY_MODEL/ROADMAP）
├── research/           历史与调研（只读资产；soak/ 为 7 天测试日报）
├── gateway/            Gateway V0.1（运行中，勿动）
├── hub/                Hub V0.1（运行中，Phase 4 开发中）
├── worker-sandbox/     Phase 4 Worker 专用测试项目（唯一可操作对象）
├── deploy/             agent-wechat Docker 部署（127.0.0.1:6174）
└── repos/              调研用 clone 存档
```

## Working Rules

1. 进入本项目先读 `docs/PROJECT_OVERVIEW.md` 和 `docs/DECISIONS.md`；涉及可靠性读 `docs/RELIABILITY_MODEL.md`；Phase 4 开发前读 `research/PHASE4_PLAN.md`。
2. 修改 Gateway 前必须确认不违反只读原则；修改后运行 `gateway/scripts/check-readonly.sh`。
3. 任何涉及运行中服务（微信容器、gateway、personal-hub）的操作前，先 `systemctl --user status` 检查。
4. 报告与文档：区分"已实现（CURRENT）"与"长期设想（PLANNED）"，不把设想写成事实；关键结论必须附源码路径/实验数据。
5. 记录失败与限制，不掩盖。
6. Hub 状态变更必须走 version 条件更新 + append-only transition log + outbox，不允许绕过。
7. Phase 4 红线：Worker 只准操作 `worker-sandbox/`；禁止真实凭据/真实项目；Enforcement 未验证前不得接入真实 Worker 流程。

## Current Priorities

1. 完成微信 Gateway 7 天稳定性测试（soak test，勿干扰）。
2. Phase 4 Real Worker Foundation（按 `research/PHASE4_PLAN.md` 十三阶段推进）。

## Do Not（当前阶段）

- 不实现 LLM 智能管线 / Push / PWA / 多信息源（Phase 7/8/9）。
- 不修改或停止运行中的 Gateway、微信容器、agent-wechat（soak 期间）。
- 不发送微信消息（任何情况下）；Hub 无 shell/项目访问能力。
- Phase 4：Worker 只准操作 `worker-sandbox/`；不碰真实项目/真实凭据。
- 不把调研中的"可参考"当作"已决定采用"；变更既有 Decision 需在报告中提出 PROPOSED CHANGE。
