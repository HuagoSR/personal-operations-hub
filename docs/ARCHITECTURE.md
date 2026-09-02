# 架构（ARCHITECTURE）

严格区分 **CURRENT（已实现）** 与 **PLANNED（计划）**。

## 一、CURRENT：微信 Gateway → Hub V0.1

```
官方微信 Linux（容器，4.1.1.4）→ agent-wechat（127.0.0.1:6174，仅 GET）
  → Gateway V0.1 collector（2s 轮询+cursor+dedup+按日 spool JSONL，systemd --user）
  → Hub V0.1（只读消费 spool，systemd --user personal-hub，127.0.0.1:8300）
      RawMessage → Event → Inbox(@提及/私聊) → TaskCandidate ← UserCommand(Web)
      → Approval(TTL) → Task + ExecutionGrant + Outbox[单事务] → Dispatcher(幂等)
      → FakeWorker(6场景) → Execution → Result(不可变) → Review(仅USER) → COMPLETED
```

- Gateway 细节与踩坑见 `research/GATEWAY_HISTORY.md`；Hub 实施见 `research/HUB_V01_REPORT.md`。
- 关键事实：`wechat_timestamp` 是发送端时钟不可靠；微信掉线→重登后补采；spool sequence 按 gateway 单调。

## 二、CURRENT：Real Worker（已完成）+ Control Web & Hub Self Project（6A–6F 已完成）

```
Hub Core（不变）
  → WorkerManager
      ├── OpenCodeWorker（适配器就绪，上游目录回归待解锁）
      └── CodexWorker（✅ Phase 4/5 已验证）
  → ExecutionGrant Enforcement（bwrap 8/8，独立 Gate）
  → Sandbox 测试项目（worker-sandbox-untrusted/）
  → Hub Self Project（SYSTEM_HUB，隔离开发副本，手动 apply）
```

Phase 6 交互模型（详见 `research/PHASE6_PRODUCT_MODEL.md`）：

```
Hub
├── Home（Global Hub，跨项目个人助手）
├── Inbox / Tasks / Approvals（全局运维视图）
└── Projects
     ├── Hub（SYSTEM_HUB，管理 Hub 自己；独立安全域）
     ├── Gomoku（USER）
     └── …
          └── Conversation（长期交互上下文 ≠ Task；结构化卡片投影）
```

关键决策（D011–D014）：零构建前端+渐进增强；Global Hub 与 Hub Self Project 永不合并；自我修改用隔离开发副本、生产永不原地编辑、手动 apply；Self 副本内 git_commit=ALLOW、push/deploy 显式批准。

分层职责不变：Hub=控制面（审批/调度/转发/审计），Worker=执行面（读码/改码/测试/git/shell）。

## 三、数据模型（V0.1 已落地，以 `hub/src/migrations/001_init.sql` 为准）

| 实体 | 要点 |
|---|---|
| raw_messages | `idempotency_key={gateway_id}:{chat_id}:{local_id}` UNIQUE；保留原文 JSON 与全部源字段 |
| events | type=wechat_message，priority_hint=normal\|mentioned；M:N 关联 raw_messages |
| inbox_items | 状态 NEW/READ/IGNORED/ARCHIVED/CONVERTED；1:1 event |
| projects / conversations / conversation_messages | workspace_path 仅登记元数据；GLOBAL_HUB 会话 |
| user_commands | 文本→候选（origin=USER_COMMAND, origin_id=cmd-N） |
| task_candidates | `UNIQUE(origin_type, origin_id)`，origin∈WECHAT_EVENT\|USER_COMMAND（不绑微信） |
| approvals | PENDING/APPROVED/REJECTED/EXPIRED/CANCELLED + expires_at(TTL) + version |
| tasks | OPEN/EXECUTING/RESULT_AVAILABLE/REVIEW/COMPLETED/CANCELLED + version |
| execution_grants | capabilities JSON 全 ALLOW/ASK/DENY + task_version 绑定 + ACTIVE/REVOKED |
| executions | QUEUED/RUNNING/WAITING_FOR_USER/WAITING_FOR_APPROVAL/RESULT_AVAILABLE/FAILED/CANCELLED；`execution_dispatch_id` UNIQUE |
| results | immutable（触发器）；summary/diff/tests/artifacts/evidence |
| transition_log / domain_events | append-only（触发器）；Actor 贯穿（actor_type/actor_id） |
| outbox_events | PENDING/DISPATCHED/FAILED/DEAD + attempts/backoff |

## 四、可靠性机制（详见 RELIABILITY_MODEL.md，已全部落地验证）

version 乐观并发；idempotency_key；append-only 日志；transactional outbox；at-least-once 投递 + effectively-once 执行；审批 TTL；Grant 吊销。

## 五、审批分层与优先级

```
L1 Task Approval（人工）→ L2 ExecutionGrant（结构化授权）→ L3 Worker Tool Approval（转发原生）
L4 High-risk（sudo/git push/破坏性删除/系统配置/凭据访问：永远人工确认）
优先级：L4 > L2 > L3 自动放行（D010）。Hub 不重写 Worker 审批协议，只做分类、转发与自动决策映射。
```

## 六、ExecutionGrant Enforcement（Phase 4 Gate，D009）

- Grant 是**逻辑策略**≠OS 边界。真实 Worker 进程若无隔离，Grant 之外的资源（~/.ssh、其他项目、secret）技术上仍可读。
- Phase 4 必须完成：workspace 隔离、network deny 实测、credential 隔离、sudo/系统配置默认禁。设计与实测见 Phase 4 报告。

## 七、关键架构决策

D001 微信永久只读 / D002 微信非控制渠道 / D003 Hub-Worker 分离 / D004 外部请求必须过候选+审批 / D005 文件与代码执行交给 Worker / D006 控制渠道 Web/PWA / D007 不用 OpenClaw / D008 transactional outbox / D009 Grant≠OS 边界（Enforcement 独立 Gate）/ D010 L4>L2>L3。全部见 DECISIONS.md。
