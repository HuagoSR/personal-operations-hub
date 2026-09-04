# Personal Operations Hub（hub/ 目录）

个人工作/信息枢纽 Agent 的核心控制面。与微信 Gateway（只读）同机运行于 huago-cone。

## 定位

- 微信永久只读 Source（不实现任何微信发送能力，不提供对应执行接口）
- Hub 只做控制面：接收信息、管理 Event/Inbox/TaskCandidate、审批、ExecutionGrant、Transactional Outbox、派发 Worker、收集 Result、Review
- Hub 不拥有 arbitrary shell / 项目文件访问；真正执行者是 Worker（FakeWorker 模拟 / Codex / OpenCode），必须经 Execution Grant + Enforcement（bwrap 沙箱）
- Intelligence = Analysis Plane（零权限，只产出 append-only 分析证据）；Worker = Execution Plane，两者严格分离

## 数据流

```
Gateway spool（只读）→ RawMessage → Event → InboxItem ──用户→ TaskCandidate
Control Web UserCommand ──────────────────────────────→ TaskCandidate
TaskCandidate → Approval(PENDING, TTL) → Task(OPEN) + ExecutionGrant + Outbox(WORKER_DISPATCH_REQUESTED) [单事务]
→ Dispatcher（幂等，execution_dispatch_id UNIQUE）→ Worker → Execution → Result(immutable)
→ Task RESULT_AVAILABLE → REVIEW（仅 USER）→ COMPLETED

Inbox 消息 ──(live shadow)──→ Episode → intelligence_job → DeepSeek 分析 → intelligence_analyses(append-only 证据)
```

## 运行

- 端口：127.0.0.1:8300（仅本机；远程访问走 SSH Tunnel：`ssh -L 8300:127.0.0.1:8300 huago-cone`）
- 数据库：`data/hub.db`（SQLite WAL）
- 服务：`systemd --user` 单元 `personal-hub`（与 wechat-gateway 同级）
- 模型 Key：`~/.hub-intelligence.env`（`HUB_INTELLIGENCE_API_KEY=…`，chmod 600，仓库外）

```bash
npm start                          # 前台运行
systemctl --user start personal-hub
systemctl --user status personal-hub
journalctl --user -u personal-hub -f
node scripts/intelligence-observe.js   # 智能分析观察期每日快照
```

部署：`scripts/deploy.ps1`（Windows 本机 → VPS，tar+scp+systemd restart；备份 hub.db 后执行）。

## 测试

```bash
npm test   # 131 项
```

131 项：可靠性矩阵（重复摄入/双审批/crash 恢复/重复派发/Worker 失败/WAITING_FOR_USER 重启恢复/审批过期/Grant 吊销/Result 不可变/Worker 不能完成 Task）+ CRASH/TIMEOUT/权限路径 + 状态机与 ingest 边界 + API 正负面用例 + 编码防线（UTF-8/密集 `?` 拦截）+ Markdown XSS 向量 + 双语字典一致性 + DOM 垫片 + Intelligence（episode 构建/切分、job 幂等与 claim、校验链、append-only、egress、预算、去重、Inbox 聚合与反馈、markInboxRead）。

评测语料与跑分：`eval/intelligence/`（corpus 15 例 13 场景 + eval-run/score/fixture）。

## 目录

```
src/
├── main.js           启动：migrate → bootstrap → ingest/dispatcher/pump/sweep/intel 循环 → HTTP(8300)
├── config.js logger.js db.js
├── migrations/       001–008（008: intelligence 五表）
├── domain/           实体 repository + 状态机常量 + 错误 + Actor（含 intelligence-*）
├── services/         tx/audit/state-machine/bootstrap/ingest/candidate/execution/
│                     grant-admin/review/user-command/dispatcher/sweep/facade
├── intelligence/     episode-builder/context-builder/egress/schema/validate/prompt/client/service
├── workers/          fake-worker / codex-worker / opencode-worker / interface / approval-policy / exec(runner)
├── api/server.js     REST + 静态页面（严格 UTF-8 + 密集 '?' 拦截）
└── web/              Dashboard/Inbox/Tasks/Approvals/Executions/Results/Projects/Conversations
                      + vendor/（Bootstrap 本地资源，无 CDN）
eval/intelligence/    语料 + 评测跑分器（runs/ 不入库）
scripts/              运维脚本（deploy/apply-hub/rollback-hub/intelligence-shadow/observe 等）
```

## 关键机制

- version 乐观并发（所有状态更新 `WHERE id=? AND state=? AND version=?`）
- idempotency_key 唯一约束（`{gateway_id}:{chat_id}:{local_id}`；origin_type+origin_id 唯一）
- append-only transition_log / domain_events / results / intelligence_analyses（触发器禁 UPDATE/DELETE）
- transactional outbox：审批事务内写入 WORKER_DISPATCH_REQUESTED；dispatcher at-least-once + dispatch_id 唯一实现 effectively-once
- 审批 TTL 过期扫描；执行 deadline watchdog；outbox retry/backoff/dead letter
- FakeWorker 场景：SUCCESS / FAIL / WAIT_FOR_USER / WAIT_FOR_APPROVAL / TIMEOUT / CRASH_ONCE_THEN_SUCCESS
- 权限决策：HIGH_RISK（sudo/system_config/git_push/outside_project）永远人工；其余 ALLOW→自动 / ASK→询问 / DENY→拒绝；Grant 吊销后不得自动放行；Hub Self 项目强制模板（覆盖只可收紧）+ workspace 强制
- 系统实体：`ensureSystemEntities()` 幂等创建 Hub Project（SYSTEM_HUB）+ General 会话 + 唯一 Global Hub
- 会话时间线：`GET /api/conversations/:id/timeline`（消息/任务/执行/结果/审批/权限/提问/apply 聚合）
- Intelligence（live shadow）：仅分析进 Inbox 的消息；身份匿名化 + 敏感 chat 禁出站（B/C/D）；episode 10min/30 条；异步独立循环，LLM 故障不阻塞 ingest；预算 $0.5/日 + $5/月 达限自动停新分析；input_hash 去重；`GET /api/intelligence/status` 观察仪表
- Inbox「看到即已读」：页面渲染后批量 `POST /api/inbox/read`（幂等）

## 安全边界

- 不调用 agent-wechat API，不写 gateway 目录（仅只读 spool 文件）
- 不修改宿主机 SSH/防火墙/systemd 系统级配置
- 日志不含消息正文与完整 chat/sender id（hash 前 8 位）
- Hub 代码不包含任何 shell 执行 / git / 网络外呼能力（模型调用走 IntelligenceModelClient 抽象）
- Hub Self 开发（D013/D014）：生产实例永不原地编辑；隔离开发副本 + 用户 Review + 手动 apply + rollback
- 微信登录/掉线故障：见 `../docs/manuals/WECHAT_LOGIN_GUIDE.md` 与 `../docs/manuals/WECHAT_GATEWAY_MANUAL.md`
