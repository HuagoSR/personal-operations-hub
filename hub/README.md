# Personal Operations Hub（hub/ 目录）

个人工作/信息枢纽 Agent 的核心控制面。与微信 Gateway（只读）同机运行于 huago-cone。

## 定位

- 微信永久只读 Source（不实现任何微信发送能力，不提供对应执行接口）
- Hub 只做控制面：接收信息、管理 Event/Inbox/TaskCandidate、审批、ExecutionGrant、Transactional Outbox、派发 Worker、收集 Result、Review
- Hub 不拥有 arbitrary shell / 项目文件访问；真正执行者是 Worker（FakeWorker 模拟 / Codex / OpenCode），必须经 Execution Grant + Enforcement（bwrap 沙箱）
- 无 LLM 智能管线、无 Push

## 数据流

```
Gateway spool（只读）→ RawMessage → Event → InboxItem ──用户→ TaskCandidate
Control Web UserCommand ──────────────────────────────→ TaskCandidate
TaskCandidate → Approval(PENDING, TTL) → Task(OPEN) + ExecutionGrant + Outbox(WORKER_DISPATCH_REQUESTED) [单事务]
→ Dispatcher（幂等，execution_dispatch_id UNIQUE）→ Worker → Execution → Result(immutable)
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

部署：`scripts/deploy.ps1`（Windows 本机 → VPS，tar+scp+systemd restart；备份 hub.db 后执行）。

## 测试

```bash
npm test   # 49 项：可靠性矩阵、状态机、API、worker 策略、编码防线、会话绑定与时间线
```

## 目录

```
src/
├── main.js           启动：migrate → bootstrap（Hub 系统实体）→ ingest/dispatcher/pump/sweep 循环 → HTTP(8300)
├── config.js logger.js db.js
├── migrations/       001–006（006: 历史中文损坏行打标）
├── domain/           实体 repository + 状态机常量 + 错误 + Actor
├── services/         tx/audit/state-machine/bootstrap/ingest/candidate/execution/
│                     grant-admin/review/user-command/dispatcher/sweep/facade
├── workers/          fake-worker / codex-worker / opencode-worker / interface / approval-policy / exec(runner)
├── api/server.js     REST + 静态页面（严格 UTF-8 请求体校验 + 密集 '?' 拦截）
└── web/              Dashboard/Inbox/Tasks/Approvals/Executions/Results/Projects/Conversations
                      + vendor/（Bootstrap 本地资源，无 CDN 依赖）
```

## 关键机制

- version 乐观并发（所有状态更新 `WHERE id=? AND state=? AND version=?`）
- idempotency_key 唯一约束（`{gateway_id}:{chat_id}:{local_id}`；origin_type+origin_id 唯一）
- append-only transition_log / domain_events（SQLite 触发器禁 UPDATE/DELETE）
- results 不可变（触发器禁 UPDATE/DELETE）；结构化事实存 `facts_json`（changed_files/diff_stat/tests_run/commit_hash）
- transactional outbox：审批事务内写入 WORKER_DISPATCH_REQUESTED；dispatcher at-least-once + dispatch_id 唯一实现 effectively-once
- 审批 TTL 过期扫描；执行 deadline watchdog；outbox retry/backoff/dead letter
- FakeWorker 场景：SUCCESS / FAIL / WAIT_FOR_USER / WAIT_FOR_APPROVAL / TIMEOUT / CRASH_ONCE_THEN_SUCCESS
- 权限决策：HIGH_RISK（sudo/system_config/git_push/outside_project）永远人工；其余 ALLOW→自动 / ASK→询问 / DENY→拒绝；Grant 吊销后不得自动放行
- 系统实体：`ensureSystemEntities()` 幂等创建 Hub Project（SYSTEM_HUB）+ General 会话 + 唯一 Global Hub 会话
- 会话时间线：`GET /api/conversations/:id/timeline`（消息/任务/执行/结果/审批/权限/提问聚合）

## 安全边界

- 不调用 agent-wechat API，不写 gateway 目录（仅只读 spool 文件）
- 不修改宿主机 SSH/防火墙/systemd 系统级配置
- 日志不含消息正文与完整 chat/sender id（hash 前 8 位）
- Hub 代码不包含任何 shell 执行 / git / 网络外呼能力
- Hub Self 开发（D013/D014）：生产实例永不原地编辑；隔离开发副本 + 用户 Review + 手动 apply + rollback
