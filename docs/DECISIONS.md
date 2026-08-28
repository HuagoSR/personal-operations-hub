# 已确定决策（DECISIONS）

采用轻量 ADR 风格。**本文件中的决定是既定约束**；如果调研发现需要改变，只能在研究报告中提出 `PROPOSED CHANGE`，不得直接修改。

---

## D001 — 微信作为永久只读 Source

- 状态：ACCEPTED（已实施并验证）
- 内容：微信 Gateway 只读，永不调用发送/open/logout 接口。
- 理由：降低账号风险、避免误发、防止外部消息形成双向控制链、简化安全模型。
- 备注：即使未来其他渠道双向交互，也不改变微信只读属性。

## D002 — 微信不是 Control Channel

- 状态：ACCEPTED
- 内容：用户对系统的控制（对话、审批、任务布置）必须走独立可信渠道（Trusted Control Channel），微信消息永不作为控制指令源。

## D003 — Hub 与 Coding Worker 分离

- 状态：ACCEPTED
- 内容：Hub 负责看/记/理解/关联/整理/分类/判断/询问/审批协调/调度/追踪/汇报；Codex/OpenCode 等 Worker 负责读码/改码/测试/执行。Hub 不成为 Codex 的替代品。

## D004 — 外部请求必须经过 Task Candidate / Approval

- 状态：ACCEPTED
- 内容：外部消息（含微信）只能形成 Information 或 TaskCandidate；必须经用户批准（Task Approval + Execution Grant）后才能执行。禁止"消息→LLM→shell"直连链路。

## D005 — 文件与代码执行交给专业 Worker

- 状态：ACCEPTED
- 内容：Hub 默认不拥有 arbitrary shell/sudo/文件系统修改；相关能力全部收敛到 Worker，并由 Execution Grant 约束。

## D006 — Control Channel 第一版优先 Web/PWA

- 状态：ACCEPTED
- 内容：第一版控制界面采用 Web UI + PWA + Push Notification，而非 Android/Windows/iOS 原生 App；目标是一套 Web/PWA 覆盖电脑、手机、平板。

## D007 — 当前不使用 OpenClaw 作为执行核心

- 状态：ACCEPTED
- 内容：Hub 执行编排不走 OpenClaw。理由（历史调研）：OpenClaw 生态定位与"Hub + 受控 Worker + 审批链路"的模型不匹配；Hub 需要自持的任务/审批/审计模型。
- 备注：不排斥未来局部参考其插件模式，若调研结论改变须走 PROPOSED CHANGE。

## D008 — 业务状态与副作用分离（transactional outbox）

- 状态：ACCEPTED（2026-08-25，架构补强轮）
- 内容：任何"状态变更 + 触发外部动作"必须在同一数据库事务内完成：状态更新 + OutboxEvent（如 WORKER_DISPATCH_REQUESTED）同事务提交，独立 dispatcher 幂等消费（带 execution_dispatch_id）。
- 理由：避免"APPROVED 后 crash"导致无法确定 Worker 是否启动；保证不丢、不重复。
- 备注：Hub V0.1（FakeWorker）阶段即落地，不延后到真实 Worker。

## D009 — ExecutionGrant 是逻辑策略；OS 级强制是独立 Gate

- 状态：ACCEPTED（2026-08-25）
- 内容：ExecutionGrant 只表达逻辑权限策略，不等于系统安全边界。真实 Worker（Codex/OpenCode）接入前，必须先完成 ExecutionGrant Enforcement 的设计与验证（sandbox/隔离/credential scoping/网络限制），作为独立 Architecture Gate。
- 理由：Grant 禁止之外的资源（~/.ssh、~/.config、其他项目）在无隔离的 Worker 进程下技术上仍可读；不能把 policy 当边界。
- 备注：FakeWorker 阶段不需要 Enforcement；Gate 位于 ROADMAP Phase 8/9 之前。

## D010 — 四层审批优先级：High-risk > Grant > Worker native

- 状态：ACCEPTED（2026-08-25）
- 内容：L4 High-risk Action 优先级高于 L2 ExecutionGrant，高于 L3 Worker 自动放行。即使 Grant 允许 run_commands/network，sudo、git push、破坏性删除、系统配置、凭据访问仍必须人工再次确认。Worker 工具级审批一律转发原生机制，Hub 不重写协议。
- 理由：防止宽泛 Grant 意外覆盖高危操作；保留最小人工干预面。

---

## 记录格式说明

- 每个 Decision 记录：状态（ACCEPTED）、内容、理由、备注。
- 新增 Decision 按 D008+ 顺序追加，附日期与讨论背景。
