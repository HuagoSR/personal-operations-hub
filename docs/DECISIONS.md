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

## D011 — 前端保持零构建 + 渐进增强；轻量库可 vendor

- 状态：ACCEPTED（2026-08-30）
- 内容：Control Web 维持 server-rendered HTML + CSS + ES modules + 渐进增强（no-build）；不引入 React/Vue 等大型前端体系。当卡片/动态状态/局部刷新使原生 JS 难以维护时，允许引入 htmx/Alpine 类轻量工具，但必须 vendor 到仓库本地（`web/vendor/`），生产运行不依赖公共 CDN。
- 理由：当前问题是信息架构与交互模型，而非技术栈新旧；先重构交互模型，避免"旧模型套新框架"。

## D012 — Global Hub 与 Hub Self Project 是两个独立实体与安全域

- 状态：ACCEPTED（2026-08-30）
- 内容：Global Hub = 跨项目的个人助手（不属于任何 Project），Hub Self Project = 管理 Hub 自身的系统项目（`project_type=SYSTEM_HUB`）。两者永不合并；权限模板完全不同。UI 上 Global Hub 显示为 Home/Assistant，Hub 专指 Self Project。
- 理由：问"今天有什么事情"不应处于拥有 Hub 源码修改权限的特殊项目中；安全域必须分离。

## D013 — 自我修改使用隔离开发工作区；生产 Hub 永不被原地编辑

- 状态：ACCEPTED（2026-08-30）
- 内容：Hub Self 开发流程 = 开发工作副本（sandbox 内）→ Codex 修改 → 测试 → Result/Diff → 用户 Review → [Prepare Update] → 用户手动 [Apply Update] → health check → 失败 rollback。Phase 6 只实现手动/半自动 apply；自动部署/自动回滚推迟。带外恢复路径（SSH + known-good tag + systemd + rollback 命令）是前置条件。
- 理由：执行部署的系统恰好也是被部署的系统；Hub 挂掉时不能依赖 Hub 自身回滚。

## D014 — Self 开发副本内 git_commit=ALLOW；push/deploy 保持显式批准

- 状态：ACCEPTED（2026-08-30）
- 内容：Hub Self development working copy 内，Codex 的 git commit = ALLOW（本地可逆、天然回滚点与审计边界；commit message 含 task id；commit hash 写入 Result）；git push、deploy、restart、生产 DB mutation 保持 ASK/HIGH_RISK。前提：仅限隔离副本、不得 commit 生产 checkout、不自动 push、hooks 禁用或审计、不得提交 credentials/runtime data。
- 理由：commit 是本地可逆操作，与 push/deploy/sudo 的外部影响本质不同；commit 链反而让自我修改更安全可审。

---

## D015 — 模型判断是证据，不是真相（LLM Analysis = Evidence/Proposal）

- 状态：ACCEPTED（2026-09-02）
- 内容：LLM 产出的一切（分析/分类/建议/置信度）都是证据与提案，不是权威状态。LLM 提取的 deadline ≠ 已确认 deadline；suggested_project ≠ 实际归属；requires_action ≠ Task 已存在。任何状态变化必须经过 Hub 确定性 service（Analysis → Policy → Approval → Grant → Dispatch）。分析结果 append-only 永不覆盖（Prompt v1 LOW 与 v2 HIGH 并存，展示指向 latest）。
- 理由：防止"模型说做了=做了"的语义漂移；可追溯、可重评估。

## D016 — 自动化等级 L0–L6 与上限

- 状态：ACCEPTED（2026-09-02）
- 内容：正式定义 L0 No Intelligence / L1 Analyze Only / L2 Suggest Classification / L3 Suggest TaskCandidate / L4 Auto-create TaskCandidate / L5 Auto-create low-risk Task / L6 Auto-dispatch low-risk Worker。Phase 7 上限 L3；L4 需用户单独批准默认关闭；L5/L6 属未来。
- 理由：逐步提高自主性必须显式分级授权，不默认递进。

## D017 — Shadow Mode 先行

- 状态：ACCEPTED（2026-09-02）
- 内容：Intelligence 真实接入后先运行 shadow：分析保存 + UI 展示建议 + 用户反馈，不自动分类移动、不自动创建 Task、不自动执行。观察期与数据达标后才评估 L4。
- 理由：让用户纠正先于自动化；Feedback 成为评测集。

## D018 — Provider 抽象与 DataEgressPolicy 分离

- 状态：ACCEPTED（2026-09-02）
- 内容：`IntelligenceModelClient.analyze(input, schema, options)` 抽象（provider/model/latency/usage/cost 记录）；v1 OpenAI 兼容（DeepSeek 端点）+ StubClient。**Provider 技术决策与真实微信内容出站授权是两件事**：后者单独 USER_DECISION_REQUIRED（选项 A 原始 / B 匿名化 / C 仅 Inbox / D 敏感 chat 禁出站 / E 本地模型）。未批准前仅 synthetic/anonymized 数据可出站。
- 理由：可替换模型；隐私边界独立可控。

## D019 — 微信只读为 System Invariant（WECHAT_WRITE = FORBIDDEN）

- 状态：ACCEPTED（2026-09-02）
- 内容：微信写入（发送/open/logout 等）是**不可覆盖的系统不变量**，任何 Project/Grant/用户 Override 不能变 ALLOW。五层强制：Gateway API surface（仅 4 个 GET）/ Worker workspace（无写路径）/ 操作白名单 / check-readonly.sh 静态门 / apply 前置门。
- 理由：shell check 只是验证门；架构约束须同时存在于多层的「默认拒绝 + 无法开启」。

## D020 — Docker socket 永不暴露 Worker

- 状态：ACCEPTED（2026-09-02）
- 内容：任何 Worker（Codex/Intelligence）永不得访问 /var/run/docker.sock 或直接执行 docker CLI。容器类操作只能经 Hub 内 Gateway Ops Facade 白名单（gateway.status / restart_collector / restart_agent_server / restart_container / health_check）+ 用户 ASK。
- 理由：Docker socket ≈ 宿主 root 控制权，可绕过 bwrap。

## D021 — Gateway 手册 = 受管理的 Harness Context Source

- 状态：ACCEPTED（2026-09-02）
- 内容：`docs/manuals/` 是长期维护、机器可消费的操作知识库（首个实例 WECHAT_GATEWAY_MANUAL.md，带 manual_version/last_verified_at/gateway_version/agent_wechat_commit/wechat_version/applies_to 元数据）。Hub Self 任务按域经 Context Registry 注入（手册路径/内容），不整体塞进系统 prompt。Gateway 任何变更/新发现必须同步更新手册。
- 理由：LLM 处理领域任务应读"产品文档"而非猜测；版本元数据让模型知道手册验证边界。

## D022 — Gateway Repair 四层 Envelope 与独立阶段

- 状态：ACCEPTED（设计基线，2026-09-02；实施授权待 USER_DECISION）
- 内容：Gateway 自愈 = Diagnose（ALLOW）/ Develop Repair（ALLOW，副本内）/ Apply Repair（ASK/HIGH_RISK）/ Operate（ASK/HIGH_RISK）四层，不搞"修 Gateway"一刀切授权。作为独立 Phase 8A（Maintenance Plane），与 Intelligence（Analysis Plane）分离。登录确认需手机端为硬限制（自动登录是特例）。
- 理由：改源码与重启生产容器风险完全不同；安全域不混淆。

- 每个 Decision 记录：状态（ACCEPTED）、内容、理由、备注。
- 新增 Decision 按 D008+ 顺序追加，附日期与讨论背景。

## D023 — Intelligence 数据出站政策 = Inbox-only + 匿名身份 + 敏感 chat Deny（B+C+D）

- 状态：ACCEPTED（2026-09-02，Phase 7 定稿）
- 内容：只有进入 Inbox 的消息可出站分析；sender/群名一律替换为稳定匿名 ID；用户可标记敏感 chat 整体永不出站（正文不做 [REDACTED] 式削改——会破坏语义理解，敏感 chat 直接整群禁出站）；不开放无条件原始发送；本地模型方案留待以后。
- 理由：把身份信息压到最低同时保留语义；敏感边界用整群 deny 而非内容阉割。

## D024 — Intelligence 输入保留：临时 Model Input 用完即弃

- 状态：ACCEPTED（2026-09-02，Phase 7 定稿）
- 内容：不为 Intelligence 建立第二份微信全文库。RawMessage 是唯一原始存储；发给 Provider 的输入是临时构建、用完即弃；永久保存仅 input_hash + append-only Analysis（output_json/reason_codes/evidence_refs）+ provider/model/token/cost/latency。Eval 语料入库流程 = 用户明确选择样本 → 匿名化 → 人工确认 → corpus。
- 理由：Analysis 是证据仓库不是原始数据仓库；隐私面最小化。

## D025 — Intelligence 预算：\/月硬上限 + \.5/日保护线

- 状态：ACCEPTED（2026-09-02，Phase 7 定稿）
- 内容：月度硬上限 \、日保护线 \.5；70%/90% 用量预警，100% 自动暂停新云分析（不影响 Inbox 与已有分析展示）。v1 只分析 Inbox + episode 聚合使调用量本应很小。
- 理由：安全阀而非成本预测；防失控。

## D026 — Shadow 观察期 = 14 天 + 指标门槛

- 状态：ACCEPTED（2026-09-02，Phase 7 定稿）
- 内容：Shadow 观察至少 14 天，且必须同时满足指标门槛才进入 7E 评估：schema validity、requires_action P/R、TaskCandidate false positive rate、urgency 准确度、project routing、prompt injection 抗性、用户纠正率、成本。关键门 = TaskCandidate false positive rate 与用户「不是任务」点击比例（假任务泛滥是首要失败模式）。
- 理由：验收看有效 episode 数与指标，不只看日历。
## 记录格式说明

- 每个 Decision 记录：状态（ACCEPTED）、内容、理由、备注。
- 新增 Decision 按 D008+ 顺序追加，附日期与讨论背景。
