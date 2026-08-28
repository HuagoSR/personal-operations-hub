# Phase 4：Real Worker Foundation — 宏观计划（PHASE4_PLAN）

- 定稿：2026-08-28（源自用户与 ChatGPT 讨论的宏观计划，梳理后作为实施基线）
- 前置：Hub V0.1 已完成并通过 24h 自测（见 HUB_V01_REPORT.md）
- 目标一句话：**让 Hub 第一次真正把任务交给 Codex/OpenCode，并且做到：能控制、能审批、能等待、能恢复、能限制越权、能拿回结果。**

## 总路线

```
Hub V0.1（可靠任务骨架）✅
  → Phase 4  Real Worker Foundation（OpenCode+Codex, Sandbox+Permissions）← 当前
  → Phase 5  Controlled Real Project Pilot（低风险项目逐步放开）
  → Phase 6  Project/Conversation UX
  → Phase 7  Hub Intelligence（LLM/Context/Task Detection）
  → Phase 8  Push/PWA
  → Phase 9  GitHub/Email/Calendar Sources
```

## 核心原则（不可违背）

1. **Hub 永远是控制面**：任务/审批/授权/调度/状态跟踪/提问转发/Permission 转发/Result 收集/审计。Hub 不修改代码、不执行 shell/git/sudo、不操作系统配置、不操作真实项目。
2. **Worker 是执行面**：读码/改码/测试/git/shell/网络全部由 OpenCode/Codex 执行；Hub 只决定 ALLOW/ASK/DENY 并转发授权结果。
3. **ExecutionGrant 是给 Worker 的授权策略**，不是给 Hub 的权限。
4. **Policy 与 Enforcement 分离**：Grant 的 `network=DENY` 只是逻辑规则，必须证明 Worker 即使尝试联网也真的会被系统阻止（Logical Authorization + Technical Enforcement）。

## 阶段划分（按序执行）

| # | 阶段 | 内容 | 产出 |
|---|---|---|---|
| 1 | 封存 V0.1 | git tag `v0.1-known-good`、文档归档、schema 版本记录；后续开发不得破坏 FakeWorker/Outbox/Task 生命周期/审批/审计/ingest | tag + 归档 |
| 2 | Worker Sandbox | `~/worker-sandbox/` 测试项目（小项目+故意 bug+少量测试）+ 诱饵资源（sandbox 外文件/假 secret/禁入目录）；**只用假凭据**；禁止真实 SSH key/API token/微信凭据 | sandbox 项目 |
| 3 | OpenCode 运行时验证 | 脱离 Hub 独立验证 `opencode serve` REST+SSE：建 session/发任务/状态/事件/permission.asked/回复/提问/回答/续会话/abort/恢复会话/diff/result；重点：WAITING_FOR_USER、permission flow、question 回复通道、session resume、server restart | OpenCode Runtime Validation Report |
| 4 | Codex 运行时验证 | 脱离 Hub 验证 app-server JSON-RPC：initialize/thread start·resume/turn start·steer·interrupt/status changed/requestApproval/requestUserInput/turn completed/thread read；区分 sendFollowup 与 requestUserInput 回复方式；验证 app-server restart + Hub 重连 + thread 恢复 | Codex Runtime Validation Report |
| 5 | **Enforcement Gate** | Grant → Policy Translator → Worker 配置 → Sandbox/OS Enforcement。边界：workspace（只能碰授权项目；不能碰其他项目/Hub 数据/Gateway 数据/home 敏感区）、network（ALLOW/ASK/DENY，实测 DENY 确实断网）、credentials（不继承 Hub secret/微信凭据/无关 SSH/API key；按任务按项目注入）、privileged（默认禁 sudo/系统配置/宿主机敏感目录） | Enforcement 设计与实测报告 |
| 6 | AgentWorker 抽象 | 统一接口：startTask/getStatus/subscribeEvents/respondToApproval/respondToQuestion/sendFollowup/cancel/getResult；Hub Core 不感知底层 Worker；协议差异全在 Adapter | 接口+骨架 |
| 7 | OpenCodeWorker | 先接 OpenCode（REST+SSE 易调试）。第一条真实闭环：Web→Task→Approval→Grant→Outbox→OpenCodeWorker→Sandbox→Result→Review。首批任务只选最简单（修小函数/让失败测试通过/解释代码/加小测试），重点是生命周期不是代码质量 | OpenCodeWorker |
| 8 | 长生命周期验证 | RUNNING→WAITING_FOR_USER→回答→RUNNING→WAITING_FOR_APPROVAL→审批→RUNNING→RESULT_AVAILABLE；并测 Hub restart/OpenCode restart/断网/SSE 重连/重复事件/重复 approval/session recovery | 测试报告 |
| 9 | CodexWorker | 在 AgentWorker 上增加 CodexWorker；**Hub Core 尽量零修改**；若必须大改 Task/Execution/Approval/Result 则停下检查抽象设计 | CodexWorker |
| 10 | Worker Manager | Worker 选择（指定/默认）、unavailable、failure、retry、换 Worker 再执行（如 Execution1 OpenCode FAILED → Execution2 Codex RESULT_AVAILABLE，Task 仍一个） | WorkerManager |
| 11 | 高风险审批链 | 正式验证 ALLOW/ASK/DENY 映射，如 git push：Worker 请求→Hub→Grant=ASK→Control Web→用户批准→回复 Worker→Worker 执行。**执行 git push 的始终是 Worker** | 审批链验证 |
| 12 | 真实 Result | 归一化 summary/changes/diff/tests/artifacts/evidence/worker/session/execution/timestamps；Worker 只能推进 RESULT_AVAILABLE，不能 COMPLETED，仍由用户 Review | Result 归一化 |
| 13 | Control Web 小升级 | 只补必要功能：Worker 实时状态/阶段性输出/WAITING_FOR_USER/permission 请求/回答/批准拒绝/查看 diff·tests·Result/取消 Worker。**不全面重写 UI** | UI 升级 |

## 故障测试清单（必须全部覆盖，不能只测 happy path）

Hub crash while Worker running / waiting approval / after approve before Worker 收到回复；Worker crash；OpenCode/Codex service restart；SSE/JSON-RPC 断连；重复 Worker event；重复 permission event；重复 dispatch；ExecutionGrant revoke while running；sandbox 越权尝试；network deny 违规；outside-project 读取尝试。

## 完成标准（全部满足才算 Phase 4 完成）

1. Hub→OpenCode→Sandbox 完整生命周期跑通；Hub→Codex→Sandbox 完整生命周期跑通
2. Permission ALLOW/ASK/DENY 均验证；Worker 可提问→等待→用户回答→继续原 session
3. Hub/Worker 重启后可恢复
4. Sandbox 实测：不能访问未授权项目/Hub secret/微信数据；network deny 有效；sudo deny 有效
5. Result：不可变、可 Review、Worker 不能自证 Task 完成

## 红线

- 所有 Gate 通过前，Worker 禁止访问：现有开发项目、真实 GitHub 凭据、服务器系统配置、微信系统目录、Hub 数据、用户 SSH 凭据
- 测试只能在专用 sandbox project 中完成
- 完成 Phase 4 后不自动开放真实项目——下一阶段（Phase 5）只选一个低风险复制仓库，从 read-only investigation 逐步扩大到 write/tests/commit，最后才考虑 push/系统操作

## 刻意后置（本阶段不做）

微信语义理解、自动项目关联、自动任务抽取、LLM/RAG、Push、Email/GitHub Source——先证明"Hub 能可靠安全调度专业 Worker"，再让 Hub 变聪明。
