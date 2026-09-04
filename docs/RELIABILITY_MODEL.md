# 可靠性模型（RELIABILITY_MODEL）

> Hub 状态可靠性的核心机制。全部已在 V0.1 落地并有测试覆盖（见 `research/HUB_V01_REPORT.md`）。实现位于 `hub/src/services/`（state-machine / tx / audit / outbox / dispatcher / sweep）。

## 1. version（乐观并发）

所有状态实体带 version；状态更新一律：

```sql
UPDATE tasks SET state=?, version=version+1 WHERE id=? AND state=? AND version=?
```

防双审批、防旧请求覆盖新状态；失败=版本冲突（幂等场景下调用方判"已处理"）。

## 2. idempotency key（幂等摄入）

- Source 摄入：`{gateway_id}:{chat_id}:{local_id}` UNIQUE——Gateway 重放只产生一条 RawMessage/Event。
- 候选侧：`origin_type + origin_id` UNIQUE——同一来源重复评估不重复建候选。

## 3. append-only 日志

`transition_log`（entity/from/to/actor/reason/time）+ `domain_events`，与状态更新**同事务**写入；SQLite 触发器禁 UPDATE/DELETE。实体当前状态=快查；日志=审计与重建。

## 4. transactional outbox

禁止"状态提交后再调 Worker"。正确模式：状态更新 + OutboxEvent 同事务 COMMIT，独立 dispatcher 幂等消费：

- 投递语义：at-least-once；`execution_dispatch_id` UNIQUE 实现 effectively-once 执行（可重复消费，Worker 不真正启动两次）
- retry/backoff/max attempts/dead letter；重启后 pending 事件继续消费

## 5. 审批与恢复

- Approval TTL：过期→不能继续执行+审计
- Grant 吊销：后续 Worker permission 不得自动放行（评测点：决策时实时读 Grant 状态）
- 执行 watchdog：RUNNING 超 deadline → FAILED（防假 RUNNING 老化）

## 6. 验收场景（V0.1 已全 PASS；Phase 4 故障矩阵见 PHASE4 报告；Phase 5 恢复实测见 PHASE5_GOMOK_FINAL_REPORT）

Source 幂等 / 双审批 / crash-after-approval / 重复派发 / Worker 失败 / WAITING_FOR_USER 重启恢复 / Approval 过期 / Grant 吊销 / Result 不可变 / Worker 不能完成 Task。

## 7. Hub Self 自举可靠性（Phase 6，D013/D014）

- 自我修改 = 隔离开发副本 + 测试全绿 + Result/Diff + commit hash + 用户 Review + 手动 apply；生产 Hub 永不原地编辑。
- 每次 apply 前自动备份（tar），`scripts/rollback-hub.sh` 提供带外回滚；health check 失败自动回滚并审计。
- 带外恢复 SOP 不依赖 Hub（SSH + known-good tag + systemd），自动部署评估前必须演练通过。
- GLOBAL_HUB 合并等数据迁移必须先备份 + 迁移测试；timeline 等只读投影不得改业务真相。

## 8. Intelligence 可靠性（Phase 7，7A–7D 已实施）

- Intelligence = **optional asynchronous enrichment**，永不是 Gateway ingestion 的同步依赖（D 系列）✅
- 独立异步 runner + 幂等 job（episode 唯一 + input_hash 去重 + attempts 上限）：LLM down/timeout/限流/schema invalid → analysis FAILED/RETRYABLE，消息照常进 Inbox，Task Core 不受影响 ✅（生产实测：live shadow 运行中）
- intelligence_analyses append-only（触发器禁 UPDATE/DELETE）：模型判断是证据不是真相（D015），历史版本永不覆盖 ✅
- 可观测：`GET /api/intelligence/status` + `scripts/intelligence-observe.js`（量/成功率/延迟/cost/schema failure/retry/confidence 分布/建议接受率）；日志不记正文 ✅
- 评测先于自动化：13 类语料 + 指标 harness（`hub/eval/intelligence/`）；Feedback 积累为真实评测集 ✅
- 预算上限：$0.5/日 + $5/月（D025），达限自动暂停新云分析不影响 Inbox ✅；v1 只分析 Inbox 消息控制调用量 ✅