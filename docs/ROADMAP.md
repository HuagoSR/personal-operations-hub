# 路线图（ROADMAP）

> 只做阶段划分，不承诺时间。进入下一阶段的判据在每阶段末尾注明。

## 已完成

- **Phase 0** 微信 Gateway 可行性验证 → DONE（2026-08-24，`research/GATEWAY_HISTORY.md`）
- **Phase 1** Gateway 7 天 soak → 完成（日报告 `research/soak/`）
- **Phase 2** Hub 架构研究 → DONE（`research/ARCHITECTURE_RESEARCH.md`）
- **Phase 3–7（合并）** Hub V0.1 → DONE（`research/HUB_V01_REPORT.md`，tag `v0.1-known-good`）
- **Phase 4** Real Worker Foundation → DONE（Codex 线全绿；OpenCode 上游回归待解锁；`research/PHASE4_REPORT_FINAL.md`）
- **Phase 5** Controlled Real Project Pilot（Gomoku）→ DONE（10 PASS + 2 PASS_WITH_NOTES，结论 READY_FOR_REAL_PROJECT_READ_ONLY；`research/PHASE5_GOMOK_FINAL_REPORT.md`）

## Control Web & Hub Self Project（6A–6F 全部完成）

把可靠工作的 Hub 从"工程验证界面"变成长期日常使用的 Personal Operations Hub；加入系统内建 Hub Self Project。设计与调研见 `research/PHASE6_PRODUCT_MODEL.md`、`PHASE6_HUB_SELF_PROJECT_DESIGN.md`、`PHASE6_PLAN.md`、`PHASE6C_UI_STUDY.md`。

- ✅ 6A 数据/产品基础（Project/Conversation 正式化、Hub Project bootstrap、Result 结构化事实、timeline API、GLOBAL_HUB 唯一修复）
- ✅ 6B 导航与 Project 工作区（Bootstrap vendor 化、侧边栏、Project 页会话优先）
- ✅ 6C Conversation-first 工作流（时间线卡片、composer、命令会话绑定、局部刷新）
- ✅ 6D 全局运维视图（Tasks 六桶分桶 tabs、Approvals 三区关注聚合「N 项需要你的关注」、Dashboard 最近活动+项目活动+Developer Details）
- ✅ 6E Hub Self 开发（Safe Self-Modification Pilot：隔离副本+模板+git 证据+apply 生命周期+带外 apply/rollback+真实 Pilot 与回滚演练；`research/PHASE6E_REPORT.md`）
- ✅ 6F UX 打磨（亮/暗主题跟随系统、中英双语切换、md-lite Markdown 渲染、toast/模态替代 alert/prompt、按钮加载态防重、侧边栏未读角标、空态/骨架屏、时间线智能刷新（无变化跳过/新增追加/变化保持现场）、相对时间戳、favicon；移动端响应式已决定暂缓）

判据：用户主要围绕 Project/Conversation 使用 Hub；后台可靠状态机/审批/审计/安全边界全部保持；Hub Self Project 可安全地在隔离工作区完成"修改→测试→审阅→手动 apply"闭环。

## 后续（Phase 6 完成后评估，不自行提前）

Real Project Read-only Pilot → Real Project Write Pilot → Push/PWA → 多信息源（Email/GitHub/Calendar）→ OpenCode re-enable → 移动端响应式（暂缓项，按需启用）

## Phase 7 — Hub Intelligence Foundation（准备完成，等待审阅）

两条飞行平面分离：**Intelligence = Analysis Plane**（本阶段）vs **Gateway Repair = Maintenance Plane**（Phase 8A，独立，不混安全域）。设计文档：`research/PHASE7_INTELLIGENCE_ARCHITECTURE.md` / `PHASE7_THREAT_MODEL.md` / `PHASE7_ANALYSIS_SCHEMA.md` / `PHASE7_EVAL_PLAN.md` / `PHASE7_PLAN.md` / `PHASE7_PREPARATION_REPORT.md`；手册：`docs/manuals/WECHAT_GATEWAY_MANUAL.md`。

- ✅ 7A Intelligence Architecture & Eval Foundation（数据模型/Schema/StubClient/Eval harness/Prompt v1；仅 synthetic）
- ✅ 7B 离线 Shadow Analysis（DeepSeek 启用；质量基线 schema 100%/F1 1.0；历史 Inbox 11/11）
- ✅ 7C Inbox Intelligence UI（enrichment + feedback 闭环）
- 🔄 7D Live Shadow Mode（**观察期进行中**：14 天 + 指标门槛，`/api/intelligence/status` 仪表 + `scripts/intelligence-observe.js` 日快照）
- ⏳ 7E Assisted TaskCandidate（一键创建，仍走 Approval；观察数据达标后评估）
- ⏳ 7F Briefing & Intelligent Routing

边界：自动化等级上限 **L3**（L4 需单独批准）；未获数据出站授权前仅 synthetic/anonymized 数据；Intelligence 永不成 ingest 同步依赖；微信只读 = System Invariant（WECHAT_WRITE=FORBIDDEN，D021）；Docker socket 永不暴露 Worker。

## Phase 8A — Gateway Self-Maintenance（独立阶段，设计就绪待单独授权）

Diagnose/Develop/Apply/Operate 四层 Envelope + Gateway Ops Facade 白名单 + `WECHAT_GATEWAY_MANUAL` 作为 Harness Context。见 `research/PHASE7_PLAN.md` 与 `docs/manuals/WECHAT_GATEWAY_MANUAL.md`。

## 阶段推进规则

- 每阶段产出对应文档/报告；新决策追加 DECISIONS.md（PROPOSED CHANGE 流程）
- 真实 Worker 接入前必须过 Enforcement Gate（D009）+ 协议运行时验证 Gate
- soak 期间冻结 Gateway 环境；本阶段 Worker 禁止碰真实项目
