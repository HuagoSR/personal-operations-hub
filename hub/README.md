# Personal Operations Hub V0.1

个人工作/信息枢纽 Agent 的最小任务生命周期骨架。与微信 Gateway（只读）同机运行于 huago-cone。

## 定位（V0.1）

- 微信永久只读 Source（不实现任何微信发送能力，不提供对应执行接口）
- Hub 只做控制面：接收信息、管理 Event/Inbox/TaskCandidate、审批、ExecutionGrant、Transactional Outbox、派发 FakeWorker、收集 Result、Review
- Hub 不拥有 arbitrary shell / 项目文件访问；真正执行者是 Worker（本阶段仅 FakeWorker，无 shell/文件/网络/git/sudo）
- 无 LLM、无真实 Worker、无 Push

## 数据流

```
Gateway spool（只读）→ RawMessage → Event → InboxItem ──用户→ TaskCandidate
Control Web UserCommand ──────────────────────────────→ TaskCandidate
TaskCandidate → Approval(PENDING, TTL) → Task(OPEN) + ExecutionGrant + Outbox(WORKER_DISPATCH_REQUESTED) [单事务]
→ Dispatcher（幂等，execution_dispatch_id UNIQUE）→ FakeWorker（6 场景）→ Execution → Result(immutable)
→ Task RESULT_AVAILABLE → REVIEW（仅 USER）→ COMPLETED
```

## 运行

- 端口：127.0.0.1:8300（仅本机；远程访问走 SSH Tunnel：`ssh -L 8300:127.0.0.1:8300 huago-cone`）
- 数据库：`data/hub.db`（SQLite WAL）
- 服务：`systemd --user` 单元 `personal-hub`（与 wechat-gateway 同级）

```bash
npm start                          # 前台运行
systemctl --user start personal-hub
systemctl --user status personal-hub
journalctl --user -u personal-hub -f
```

## 测试

```bash
npm test
```

108 项：可靠性（重复摄入/双审批/crash 恢复/重复派发/Worker 失败/WAITING_FOR_USER 重启恢复/审批过期/Grant 吊销/Result 不可变/Worker 不能完成 Task）+ CRASH/TIMEOUT/权限路径 + 状态机与 ingest 边界 + API happy path 与负面用例 + 编码完整性 + Markdown 渲染与 XSS 向量 + 双语字典一致性 + 页面脚本双语言执行（DOM 垫片）。

## 目录

```
src/
├── main.js           启动：migrate → ingest/dispatcher/pump/sweep 循环 → HTTP(8300)
├── config.js logger.js db.js
├── migrations/001_init.sql
├── domain/           实体 repository + 状态机常量 + 错误 + Actor
├── services/         tx/audit/state-machine/ingest/candidate/approval 相关/
│                     execution/grant-admin/review/user-command/dispatcher/sweep/facade
├── workers/fake-worker.js
├── api/server.js     REST + 静态页面
└── web/              Dashboard/Inbox/Tasks/Approvals/Executions/Results/Projects/Conversations
```

## 关键机制

- version 乐观并发（所有状态更新 `WHERE id=? AND state=? AND version=?`）
- idempotency_key 唯一约束（`{gateway_id}:{chat_id}:{local_id}`；origin_type+origin_id 唯一）
- append-only transition_log / domain_events（SQLite 触发器禁 UPDATE/DELETE）
- results 不可变（触发器禁 UPDATE/DELETE）
- transactional outbox：审批事务内写入 WORKER_DISPATCH_REQUESTED；dispatcher at-least-once + dispatch_id 唯一实现 effectively-once
- 审批 TTL 过期扫描；执行 deadline watchdog；outbox retry/backoff/dead letter
- FakeWorker 场景：SUCCESS / FAIL / WAIT_FOR_USER / WAIT_FOR_APPROVAL / TIMEOUT / CRASH_ONCE_THEN_SUCCESS
- 权限决策：HIGH_RISK（sudo/system_config/git_push/outside_project）永远人工；其余 ALLOW→自动 / ASK→询问 / DENY→拒绝；Grant 吊销后不得自动放行

## 安全边界

- 不调用 agent-wechat API，不写 gateway 目录（仅只读 spool 文件）
- 不修改宿主机 SSH/防火墙/systemd 系统级配置
- 日志不含消息正文与完整 chat/sender id（hash 前 8 位）
- Hub 代码不包含任何 shell 执行 / git / 网络外呼能力
