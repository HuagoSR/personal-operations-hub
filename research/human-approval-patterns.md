# 人工审批模式比较研究

- 调研日期：2026-08-25
- 核心命题：**Hub 级 Approval（任务该不该做）** 与 **Worker 级 Tool Permission（运行中的单个动作该不该放行）** 是两种不同的审批，不能混为一谈。

## 1. 五种审批机制对比

| 机制 | 挂起点 | 恢复方式 | 持久化 | 适用层级 |
|---|---|---|---|---|
| LangGraph `interrupt()` / `Command(resume)` | 图节点内同步挂起 | resume 后**重跑该节点**，interrupt 返回决策 | Postgres checkpoint（thread_id 维度） | Hub 流程级（分类→审批→继续） |
| Forge Gate + awaiting_human | 状态机 Gate（requires_user_approval） | approve/reject API（校验 version） | SQLite transition_log + 任务状态 | Hub 任务级 + 执行门禁 |
| crewAI guardrail / human_input | 任务完成后外部裁决 | guardrail 函数返回 / human_input 反馈循环 | 无内置（由外层实现） | 结果验证级 |
| Codex requestApproval | JSON-RPC server→client 请求（command/fileChange） | 回复 decision 枚举（accept/acceptForSession/decline/cancel） | 无内置持久化（连接即会话） | Worker 工具级 |
| OpenCode permission | `permission.asked` 事件 | `POST /session/:id/permissions/:permissionID` | 服务端会话内 | Worker 工具级 |

## 2. 关键结论

### 2.1 LangGraph HITL（frontdesk-agent 实证）
- 优点：`interrupt()` 语义极简（挂起点=恢复点，节点重跑幂等）；Postgres checkpoint 跨进程恢复有集成测试证明（`persistence.integration.spec.ts`，A 进程挂起 → B 进程 resume → C 进程重放幂等）。
- 代价：checkpoint 是二进制状态、调试需看 DB；graph 编译层抽象；LangChain 包依赖。
- 适用性判断：适合**秒~分钟级、同 graph 内**的交互流（对话式分类→审批→继续）。我们的 Hub 审批是**小时~天级、跨系统**的流程（用户看到通知→打开 Web→批准→Worker 启动），恢复单位是 Task 状态而非 graph 节点——LangGraph 的线程恢复能力收益有限，而其依赖与调试成本真实存在。

### 2.2 Forge 的两级设计（最接近我们）
- **Gate**（工作流级）：PLANNING 需用户批准、REVIEW/MERGING 有 max_rejections 拒绝预算（`default_workflow.rs:215-258`）——对应我们的 Task Approval。
- **WorkspaceLease**（执行级）：不透明 capability、绑定 task_version+execution_id、事务签发/吊销（`governance.rs:626-733`）——对应我们的 ExecutionGrant。
- **Worker 级**：Forge 把 Codex 的 requestApproval 直接透传处理（适配器层）——与我们"Worker Tool Approval 下放给 Worker 原生机制 + Hub 转发"一致。

### 2.3 转发 vs 重做的选择
- Codex/OpenCode 都有原生工具级审批（decision 枚举 / once·always·reject）。Worker Manager 的职责是**转发**（把审批请求推给 Control Channel，把用户决策送回），而不是自己重做一套工具白名单——重复造轮子且与 Worker 内部语义脱节。
- 唯一需要 Hub 自己做的工具级策略：按 ExecutionGrant 预设"自动同意/自动拒绝"映射（例如 grant.network=false → Codex 网络类 approval 自动 decline），减少打扰。

## 3. 推荐审批分层（四层，含优先级）

```
L1 Task Approval（Hub 级，人工）
   "这个任务要不要做？" → TaskCandidate → Task
   载体：Inbox 通知 → 用户 approve/reject

L2 Execution Grant（Hub 级，结构化）
   "允许 Worker 做什么范围？" → 随 Task/Execution 签发
   载体：结构化权限对象（read/write/run_tests/run_commands/network/install_deps/git_commit/git_push/sudo/system_config）
   借鉴：Forge WorkspaceLease（不透明 capability、绑定版本、可吊销）

L3 Worker Tool Approval（Worker 级，可半自动）
   "运行中的 agent 的单个动作放行吗？" → 转发 Worker 原生审批
   载体：Codex item/*/requestApproval ↔ OpenCode permission.asked
   策略：Grant 内允许的 → 自动 accept；Grant 外的 → 推给用户（once/always/reject）

L4 High-risk Action（Hub 级，独立确认）
   sudo、git push、网络外呼、系统配置、rm 类命令、凭据访问
   即使 Grant 允许也要再次人工确认；记录到审计
```

### 优先级关系（本轮补强，D010）

**ExecutionGrant 不是最高权限。** 优先级：`L4 > L2 > L3 自动放行`。

即使 Grant 声明 `run_commands: true, network: true`，sudo / git push / 破坏性删除 / 系统配置 / 凭据访问仍属 High-risk，必须人工再次确认。

决策流程：

```
Worker requests action
        ↓
High-risk classifier / policy
        │
        ├── HIGH RISK → L4 人工确认（无论 Grant 内容）
        │
        └── NORMAL → ExecutionGrant 检查
                ├── Grant 允许 → 自动放行（respond accept）
                ├── Grant 禁止 → 自动拒绝（respond decline）
                └── Grant 未声明 → 转用户 ask（once/always/reject）
```

Hub 不重写 Worker 的工具审批协议，只做分类、转发与自动决策映射。

## 4. 对我们 Hub 的实现建议

1. **Hub Core 不采用 LangGraph**（第一版）：用自研轻量状态机 + 事件表（SQLite/Postgres），状态字段驱动（TaskCandidate→Task→Execution…）；审批请求是持久化记录（含超时、抢占、撤销），不是进程内 interrupt。理由：审批时间尺度（小时~天）与多系统流转超出 graph checkpoint 的收益区间；LangGraph 留作"Hub 推理链"复杂化后的可选增强（PROPOSED CHANGE 权限在 DECISIONS.md 流程下评估）。
2. **审批对象持久化为一等实体**（Approval 表/集合）：who/when/what/decision/grant 快照——审计链的核心。
3. **Worker 工具审批一律转发原生机制**，Hub 不做第三套白名单；只在 Grant 层做自动决策映射。
4. 防悬挂：审批请求带 TTL（借鉴 codelight 590s 超时回落与状态老化），超时自动按预设策略处理并记录。
