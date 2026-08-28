# 路线图（ROADMAP）

> 只做阶段划分，不承诺时间。进入下一阶段的判据在每阶段末尾注明。

## 已完成

- **Phase 0** 微信 Gateway 可行性验证 → DONE（2026-08-24，`research/GATEWAY_HISTORY.md`）
- **Phase 1** Gateway 7 天 soak → 进行中（2026-08-25 起，日报告 `research/soak/`，勿干扰）
- **Phase 2** Hub 架构研究 → DONE（2026-08-25，`research/ARCHITECTURE_RESEARCH.md`）
- **Phase 3–7（合并）** Hub V0.1：数据模型+状态机+outbox+dispatcher+FakeWorker+spool 摄入+Control Web → DONE（2026-08-27，26 测试 PASS + 24h 自测 PASS，`research/HUB_V01_REPORT.md`，tag `v0.1-known-good`）

## Phase 4 — Real Worker Foundation（当前）

用真正 OpenCode/Codex Worker 替换 FakeWorker，Hub 能控制/审批/等待/恢复/限制越权/拿回结果。十三阶段 + 完成标准详见 `research/PHASE4_PLAN.md`：

1. 封存 V0.1 → 2. Sandbox 测试项目+诱饵 → 3. OpenCode 运行时验证 → 4. Codex 运行时验证 → 5. **Enforcement Gate**（workspace/network/credentials/privileged）→ 6. AgentWorker 抽象 → 7. OpenCodeWorker → 8. 长生命周期验证 → 9. CodexWorker → 10. WorkerManager → 11. 高风险审批链 → 12. 真实 Result → 13. Control Web 小升级

判据：OpenCode+Codex 双 Worker 完整闭环；ALLOW/ASK/DENY 全验证；重启恢复；sandbox 越权实测全挡住；Result 不可变+用户 Review。

## 后续（Phase 4 完成后再启动）

- **Phase 5** Controlled Real Project Pilot：只选一个低风险复制仓库，read-only → write/tests/commit → 最后才 push/系统操作
- **Phase 6** Project/Conversation UX（Dashboard→Project→多会话→Hub+Worker 交互）
- **Phase 7** Hub Intelligence（LLM/上下文/任务检测；LangGraph 如需引入走 PROPOSED CHANGE）
- **Phase 8** Push/PWA
- **Phase 9** GitHub/Email/Calendar Sources

## 阶段推进规则

- 每阶段产出对应文档/报告；新决策追加 DECISIONS.md（PROPOSED CHANGE 流程）
- 真实 Worker 接入前必须过 Enforcement Gate（D009）+ 协议运行时验证 Gate
- soak 期间冻结 Gateway 环境；本阶段 Worker 禁止碰真实项目
