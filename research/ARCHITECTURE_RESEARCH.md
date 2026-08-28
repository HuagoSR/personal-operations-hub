# Hub 架构调研总结（ARCHITECTURE_RESEARCH）

> 浓缩自 HUB_ARCHITECTURE_RESEARCH_REPORT / HUB_ARCHITECTURE_REVIEW_V2 / hub-agent-project-comparison（2026-08-25）。原始论证已归档于 VPS `~/research-archive-20260828.tar.gz`。

## 1. 核心结论

| 问题 | 结论 |
|---|---|
| 现成项目能直接当 Hub 吗 | **NO**。Forge 最接近（Task 状态机/审批/租约/审计），但缺"不可信 Source→事件理解→Inbox"层；其余项目单维。无人整体覆盖 |
| Hub Core 自研 or 框架 | **自研轻量状态机 + 事件表（SQLite）**。理由：Hub Core = durable business workflow（业务实体即状态、SQL 可查可修、可审计），不是 durable reasoning graph；LangGraph 保留给未来 Intelligence Pipeline（需走 PROPOSED CHANGE） |
| Worker Manager | 五实体模型（Task/Execution/Worker/WorkerSession/Result）+ 借鉴 Forge 三件套（ExecutionGrant≈WorkspaceLease、声明式状态机+Gate、transition_log） |
| Codex 接入 | app-server JSON-RPC 直连（unix socket/stdio）；审批是协议内一等请求（`item/*/requestApproval` + decision 枚举）；不解析 CLI stdout。风险：协议无版本号，接入期需实测钉版本 |
| OpenCode 接入 | `opencode serve` REST + SSE（`/doc` OpenAPI、`permission.asked/replied`、`POST /session/:id/permissions/:permissionID`）。question 回复通道是待验证项 |
| 审批分层 | 四层：L1 Task Approval（人工）/ L2 ExecutionGrant（结构化）/ L3 Worker Tool Approval（转发原生）/ L4 High-risk（人工独立确认）。**优先级 L4 > L2 > L3 自动放行**（D010） |
| Control Channel | 自研最小 Web（V0.1 已实现）+ 未来 PWA/Push；不采用现成 remote-control UI |

## 2. 外部项目判定（复用价值）

| 项目 | 判定 |
|---|---|
| ForgeAILab/forge | REFERENCE（Lease/Gate/审计/适配器分层参考） |
| henrikekblad/codelight | REFERENCE（状态识别三层法、TTL 老化、阻塞式审批转发） |
| athal7/opencode-pilot | 部分 ADAPT（OpenCode HTTP 客户端模式） |
| nilushan/langgraph-frontdesk-agent | REFERENCE（LangGraph HITL 参考，未来 Intelligence 若引入） |
| crewAIInc/crewAI | REJECT（guardrail"外部裁决"思想、不可变结果对象可借鉴） |
| iii-experimental/openview | REFERENCE only（极早期：QueueTask 租约语义、Artifact/Evidence 形状；无 enforcement，不可用） |
| openai/codex app-server-client | ADAPT（CodexWorker 适配器参考其客户端） |
| opencode 官方 SDK | ADAPT（OpenCodeWorker 用官方 SDK） |

## 3. AgentWorker 统一接口（概念，Phase 4 落地）

```
startTask(project, task, grant) -> executionId
getStatus(executionId)
subscribeEvents(executionId)          // 状态/审批/输出增量
respondToApproval(executionId, approvalId, decision)
respondToQuestion(executionId, questionId, answer)   // 待验证项
sendFollowup(executionId, text)       // 用户主动追加（≠回答问题）
cancel(executionId)
getResult(executionId) -> {summary, diff, tests, artifacts, evidence}
```

两端差异由 Adapter 屏蔽：Hub Core 不知道底层是 Codex 还是 OpenCode。配套：session 状态 TTL 老化（防假 RUNNING）；"需用户介入"以 Worker 主动事件为准，轮询只做兜底；executionId ↔ threadId/sessionID 映射持久化支持重启恢复。

## 4. 与 Phase 4 直接相关的遗留 Gate（V0.1 未做，现在要补）

1. **ExecutionGrant Enforcement**：Grant 是逻辑策略≠OS 边界；真实 Worker 前必须完成 sandbox/隔离/credential scoping/网络限制的设计与验证（D009）
2. **Codex 协议运行时验证**：真实 app-server 实测 initialize/thread/turn/审批回复/interrupt 全链路
3. **OpenCode 运行时验证**：`/doc` OpenAPI、SSE payload、`permission.asked/replied`、question 回复通道、prompt_async 语义
4. High-risk policy 在真实审批流中闭环验证
