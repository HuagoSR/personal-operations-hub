# Personal Operations Hub

一个长期运行的个人工作/信息枢纽 Agent：持续接收外部信息（首个信息源为普通微信群，**永久只读**），整理为事件与潜在任务，经用户批准后把工程任务交给专业 Coding Agent（OpenCode / Codex）执行。Hub 本身负责协调、追踪、询问、汇报，不亲自承担编程工作。

```
Sources（微信 → 未来 Email/GitHub/Calendar）
  ↓
Hub Core（Event / Inbox / TaskCandidate / Approval / ExecutionGrant / Outbox / 审计）
  ↓
Worker Manager
  ├── OpenCodeWorker
  └── CodexWorker
  ↓
Sandbox / 项目（受 ExecutionGrant + Enforcement 约束）
```

## 组件

| 目录 | 说明 |
|---|---|
| `gateway/` | 微信只读 Gateway：官方微信容器 → agent-wechat → 只读采集（GET-only，2s 轮询 + cursor + 按日 spool） |
| `hub/` | Hub Core：SQLite 业务状态机 + 事务 Outbox + 幂等 Dispatcher + Control Web（Node.js 零依赖） |
| `deploy/` | agent-wechat Docker 编排（127.0.0.1:6174） |
| `docs/` `research/` | 架构 / 决策 / 可靠性模型 / 历史与调研 |

## 当前状态

- Gateway 与 Hub V0.1 已运行并验证（26 项测试 + 24h 自测通过）
- Phase 4（Real Worker Foundation：OpenCode/Codex + Enforcement）进行中，见 `research/PHASE4_PLAN.md`
- 尚无：LLM 智能管线、Push、多信息源

## 关键原则

1. 微信是 **Untrusted Read-Only Source**：永不发送、永不作控制渠道
2. Hub 是控制面（审批/调度/转发/审计），Worker 是执行面（读码/改码/测试/git/shell）
3. 外部消息只能形成信息/任务候选，绝不能直接触发执行
4. 任何执行都经 Task Approval + ExecutionGrant（ALLOW/ASK/DENY）；Grant 只是逻辑策略，真实 Worker 必须叠加 Enforcement（sandbox/隔离）
5. 可靠性优先：version 乐观并发、幂等键、append-only 审计、transactional outbox（详见 `docs/RELIABILITY_MODEL.md`）

## 运行

```bash
# VPS 上（系统化部署细节见 hub/README.md）
systemctl --user start wechat-gateway
systemctl --user start personal-hub
# Control Web：http://127.0.0.1:8300（经 SSH Tunnel 访问）
```

## 注意

- 仓库不含任何真实数据/凭据：Gateway spool、Hub 数据库、token 均在 `.gitignore`
- 当前 Worker 只准操作专用 sandbox 项目，不碰真实项目
