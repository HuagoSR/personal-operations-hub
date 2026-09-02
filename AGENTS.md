# AGENTS.md — Personal Operations Hub

## Project

长期运行的个人工作/信息枢纽 Agent：持续接收外部信息（首个信息源为普通微信群，永久只读），理解与用户相关的内容，整理为事件与潜在任务，经用户批准后把工程任务交给专业 Coding Agent（Codex / OpenCode）执行。Hub 本身负责协调、追踪、询问、汇报，不亲自承担复杂编程工作。

## Current Status

- **微信 Gateway**（✅）：官方 Linux 微信（容器）→ agent-wechat → 微信本地数据库只读读取 → Gateway V0.1 collector，systemd --user 托管，7 天 soak 通过。历史见 `research/GATEWAY_HISTORY.md`。
- **Hub V0.1**（✅）：自研状态机 + SQLite（node:sqlite）+ 事务 Outbox + 幂等 Dispatcher + spool 只读摄入 + Control Web（127.0.0.1:8300，systemd --user `personal-hub`）。tag `v0.1-known-good`。
- **真实 Worker**（✅）：CodexWorker 端到端闭环（bwrap Enforcement 8/8、权限 ALLOW/ASK 链、真实修复任务）；OpenCodeWorker 适配器就绪，被上游 models.dev 目录回归阻断（解锁路径见 `research/PHASE4_REPORT_FINAL.md`）。
- **受控试点（Gomoku）**（✅）：10 PASS + 2 PASS_WITH_NOTES，结论 READY_FOR_REAL_PROJECT_READ_ONLY。
- **Control Web 重构与 UX 打磨**（✅ 6A–6F）：数据基础（Hub Self 系统项目 + GLOBAL_HUB 唯一 + conversation 关联 + Result 结构化事实）、侧边栏导航（Bootstrap vendor 化、Home=Global Hub）、Conversation-first 时间线（消息/任务/执行/结果/审批卡片 + composer + 命令会话绑定 + 智能刷新）、全局运维视图（Tasks 分桶 tabs、Approvals 三区聚合面板、Dashboard 活动流）；UX 打磨（6F）：亮/暗主题（跟随系统）、中英双语切换、md-lite Markdown 渲染、toast 统一提示与模态输入、操作按钮加载态防重、侧边栏未读角标、空态/骨架屏、时间线智能刷新（无变化跳过/新增追加/变化保持现场）、相对时间戳、favicon。移动端响应式已决定暂缓。
- **Hub Self 开发闭环**（✅ 6E 完成）：`phase6d-known-good` 基线 + `~/worker-sandbox-untrusted/hub-dev/` 隔离副本；SELF_PROJECT_TEMPLATE（覆盖只可收紧、workspace 强制）；git 证据入 Result facts；apply_requests 生命周期（Prepare → 手动 apply → APPLIED）；带外脚本 `scripts/{prepare-update,apply-hub,rollback-hub}.sh` + `hub-backups/manifest.json`。注意：self-commit 后必须先合并回本地主仓再同步 hub-dev；生产目录无 git，靠 tar 备份回滚。
- 无 LLM 智能管线、无通知系统。

## Architecture Principles

1. 微信是 **Untrusted Read-Only Information Source**，永久只读，永远不是控制渠道。
2. Hub 与 Coding Worker 严格分离：Hub=控制面（审批/调度/转发/审计），Worker=执行面（读码/改码/测试/执行）。
3. 外部消息只能形成 Information / Task Candidate，绝不能直接触发服务器执行。
4. Hub 默认不拥有 arbitrary shell；文件与 shell 能力属于 Worker，且必须经过 Execution Grant + Enforcement。
5. 数据流保持来源链：RawMessage → Event → TaskCandidate → Approval → Task → Execution → Result，每步可追溯。
6. Task 与 Execution 分离；Worker Session 是长生命周期的（可能 WAITING_FOR_USER 后继续）。
7. 核心数据模型围绕 Event/Task 构建，不与微信强耦合（未来可接入 Email/GitHub/Calendar/RSS）。
8. 业务真相永远在 SQLite；前端只是投影（刷新后必须从服务端完整恢复）。

## Safety Boundaries

- **禁止**调用任何微信发送/open/logout 接口；Gateway 对 agent-wechat 只发 GET。静态检查脚本：`gateway/scripts/check-readonly.sh`。
- 微信消息（即使 @ 当前账号、来自熟人）一律视为不可信输入。
- 任何任务执行前必须获得用户批准及明确权限边界（Execution Grant），包括：读写范围、命令、网络、git push、sudo 等。
- 秘密数据（token、微信 DB key、完整 wxid、二维码、聊天原文）不得进入 Git、不得打印到日志；日志中的 chat/sender id 使用 sha256 前 8 位。
- 不修改宿主机 SSH/防火墙/systemd 系统级配置（除非用户明确批准）。
- 端口只绑定 127.0.0.1；远程访问走 SSH Tunnel（`ssh -L 8300:127.0.0.1:8300 huago-cone`）。
- Hub Self Project 红线（D012–D014）：生产实例永不原地编辑；生产 DB mutation/restart 必须 ASK；微信凭据与 sudo/系统配置 DENY；自我修改 = 隔离开发副本 + 测试 + 用户 Review + 手动 apply + 回退路径；Self 副本内 git_commit=ALLOW，push/deploy 显式批准。

## Repository Structure

```
项目根（VPS: ~/wechat-linux-research/；GitHub: HuagoSR/personal-operations-hub）
├── AGENTS.md           本文件
├── docs/               正式文档（PROJECT_OVERVIEW/ARCHITECTURE/SECURITY_MODEL/DECISIONS/RELIABILITY_MODEL/ROADMAP）
├── research/           历史与调研（只读资产；阶段报告不上 GitHub）
├── gateway/            Gateway V0.1（运行中，勿动）
├── hub/                Hub（src 代码 + tests + scripts + web vendor 资源）
├── deploy/             agent-wechat Docker 部署（127.0.0.1:6174）
├── repos/              调研用 clone 存档（不在 GitHub 仓库）
└── hub-backups/        hub.db 迁移前备份（不在 GitHub 仓库）
```

## Working Rules

1. 进入本项目先读 `docs/PROJECT_OVERVIEW.md` 和 `docs/DECISIONS.md`；可靠性读 `docs/RELIABILITY_MODEL.md`；前端改造先读 `research/PHASE6C_UI_STUDY.md` 的取舍表。
2. 修改 Gateway 前必须确认不违反只读原则；修改后运行 `gateway/scripts/check-readonly.sh`。
3. 任何涉及运行中服务（微信容器、gateway、personal-hub）的操作前，先 `systemctl --user status` 检查。
4. 报告与文档：区分"已实现（CURRENT）"与"长期设想（PLANNED）"，不把设想写成事实；关键结论必须附源码路径/实验数据。
5. 记录失败与限制，不掩盖。
6. Hub 状态变更必须走 version 条件更新 + append-only transition log + outbox，不允许绕过。
7. 不自行决定：换前端技术栈、大框架迁移、改状态机/安全模型/Gateway、公网暴露、自动部署、Hub Self 提权（USER_DECISION_REQUIRED）。
8. 每阶段完成要求：实现 → 自动测试 → UI smoke → 更新日志/文档 → 小报告 → 停等审阅。
9. 生产数据迁移前必须先备份 hub.db；git 提交信息不含 "phase" 字样、不含隐私信息、不加阶段报告。

## Lessons & Gotchas（踩过的坑，勿重蹈）

1. **禁止用 PowerShell 5.1 默认编码批量编辑仓库 UTF-8 文件**（Get-Content/Set-Content 会按 GBK 误读造成「繁体字」乱码）。批量文本操作用能指定 UTF-8 的工具。已有测试 `tests/encoding-fix.test.js` 兜底校验全部 web 文件编码与中文标记。
2. 中文经非浏览器客户端（PowerShell/某些 CLI）POST 会逐字变成 `?` 且不可逆。服务端已有两道拦截：非法 UTF-8 → 400；密集 `?`（≥8 个）→ 400。中文输入请用浏览器。
3. 部署后用户可能看到旧页面缓存 → 提醒 Ctrl+F5。
4. deploy.ps1 内联脚本含 CRLF（`head -n 8\r` 报错属已知无害现象）；scp 与 tar 均为字节透明，不会破坏编码。
5. 生产库曾出现 3 个 GLOBAL_HUB（findOrCreate 并发重复）→ 已加部分唯一索引；系统实体用 `services/bootstrap.js` 幂等创建。
6. hub.db 的 results/transition_log/domain_events 不可变（触发器），修复数据只能加标记列/新行，不能 UPDATE。
7. Windows 本地开发机与 VPS 是两套工作副本：本地 `F:\CloudCone\Wechat\`，VPS `~/wechat-linux-research/`；GitHub 仓库在本地 `personal-operations-hub/`，改动经手动同步后 push。

## Current Priorities

1. UI 完善已闭环（6A–6F，108 测试全绿）；移动端响应式暂缓，后续按需启用。
2. Hub Self 开发闭环（6E，按 `research/PHASE6_HUB_SELF_PROJECT_DESIGN.md`）与 UX 打磨（6F）。
3. 保持已运行系统稳定（Gateway / personal-hub / 微信容器，勿干扰）。

## Do Not

- 不实现 LLM 智能管线 / Push / PWA / 多信息源（Phase 6 之后评估）。
- 不修改或停止运行中的 Gateway、微信容器、agent-wechat。
- 不发送微信消息（任何情况下）。
- 不把调研中的"可参考"当作"已决定采用"；变更既有 Decision 需提出 PROPOSED CHANGE。
