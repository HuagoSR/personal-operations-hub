# Hub V0.1 实施报告（HUB_V01_REPORT）

> 浓缩自 HUB_V01_IMPLEMENTATION_BASELINE / IMPLEMENTATION_LOG / TEST_REPORT / FINAL_REPORT（2026-08-26~27）。原报告已归档于 VPS `~/research-archive-20260828.tar.gz`。

## 1. 交付物

- 代码：`hub/`（Node.js 零依赖，`node:sqlite`；本地 git 3 提交，tag `v0.1-known-good`）
- 部署：VPS `~/wechat-linux-research/hub/`，systemd --user `personal-hub`（127.0.0.1:8300）+ `personal-hub-selftest.timer`（每小时采样）
- 数据流：Gateway spool（只读）→ RawMessage → Event → Inbox(@提及/私聊规则) → TaskCandidate ← UserCommand；候选 → Approval(TTL) → Task + ExecutionGrant + Outbox(单事务) → Dispatcher(dispatch_id 幂等) → FakeWorker(6 场景) → Result(不可变) → 用户 Review → COMPLETED

## 2. 核心机制

- version 乐观并发（`WHERE id=? AND state=? AND version=?`）；idempotency_key 唯一（`{gateway_id}:{chat_id}:{local_id}`、origin_type+origin_id）
- append-only transition_log / domain_events / results（SQLite 触发器禁 UPDATE/DELETE）
- transactional outbox：审批事务内同提交；at-least-once 投递 + effectively-once 执行；retry/backoff/dead letter
- 权限决策：HIGH_RISK（sudo/system_config/git_push/outside_project）永远人工；ALLOW→自动 / ASK→询问 / DENY→拒绝；Grant 吊销后禁止自动放行
- FakeWorker 场景：SUCCESS / FAIL / WAIT_FOR_USER / WAIT_FOR_APPROVAL / TIMEOUT / CRASH_ONCE_THEN_SUCCESS

## 3. 测试与验证结果

- **26/26 测试 PASS**（本地 Node 24 与 VPS Node 22.23.2 双环境）：可靠性 Test 1–10（重复摄入/双审批/crash 恢复/重复派发/Worker 失败/WAITING_FOR_USER 重启恢复/审批过期/Grant 吊销/Result 不可变/Worker 不能完成 Task）+ 状态机/ingest 边界 + API happy/负面用例
- **24h 自测 PASS**：连续 30h+ 运行；30 个整点采样 0 缺口 0 计数回退；`integrity_check=ok`；内存稳定 38.9MB；outbox 3/3 DISPATCHED 0 DEAD
- **生产实测**：历史 spool 41 条全量摄入 0 重复；SIGKILL 崩溃恢复（WAITING_FOR_USER 状态保持、回答后同一 Execution 继续）；用户经 UI 实际跑通任务闭环；审计链逐条核对完整
- 安全越界四项（Hub shell / Hub 改项目 / Hub 发微信 / FakeWorker 访问项目）全部 **NO**

## 4. 结论与遗留风险

- 结论：**READY_FOR_NEXT_PHASE**（任务生命周期骨架可靠，可进入 Real Worker 阶段）
- 遗留：`node:sqlite` experimental（Node 升级需回归）；Inbox 规则为启发式（无 LLM）；ExecutionGrant 仅是逻辑策略（真实 Worker 前必须过 Enforcement Gate）；spool 明文聊天数据依赖文件权限
