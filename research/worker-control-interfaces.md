# Worker 控制接口研究：Codex app-server vs OpenCode Server

- 调研日期：2026-08-25
- 依据：openai/codex 源码（codex-rs app-server crates，commit 与 VPS 安装的 codex-cli 0.146.0 同源）、OpenCode 官方文档（opencode.ai/docs/server、/docs/plugins，2026-08-25）

## 1. Codex app-server（JSON-RPC）

### 传输与启动
- 三种传输：Stdio（JSONL 逐行）/ UnixSocket（WebSocket upgrade）/ WebSocket（`app-server-transport/src/transport/mod.rs:75-80`）
- socket：`$CODEX_HOME/app-server-control/app-server-control.sock`（mod.rs:54-64）
- 启动：`codex app-server --listen unix://…`；常驻：`codex app-server daemon start`（`app-server/src/main.rs:29-36`）
- 协议：仿 JSON-RPC 2.0（省略 `jsonrpc` 字段），四类消息 Request/Notification/Response/Error（`app-server-protocol/src/rpc.rs:37-88`）；140+ 客户端方法（`app-server-protocol/src/protocol/common.rs:496-1408`）
- 权威文档：`codex-rs/app-server/README.md`（2701 行）

### 关键方法（Worker Adapter 所需最小集）

| 用途 | 方法 | 依据 |
|---|---|---|
| 握手 | `initialize`（携 clientInfo+capabilities）→ `initialized` 通知 | protocol/v1.rs:29-66 |
| 建会话 | `thread/start`（cwd、title） | v2/thread.rs:62 |
| 恢复会话 | `thread/resume` | v2/thread.rs:335 |
| 发任务 | `turn/start`（`{threadId, input: [UserInput]}`；UserInput=Text/Image/Skill…） | v2/turn.rs:71-75,297-330 |
| 运行中追加 | `turn/steer` | v2/turn.rs:180-202 |
| 打断/取消 | `turn/interrupt` | v2/turn.rs:214-222 |
| 枚举/读取 | `thread/list`、`thread/read{includeTurns}` | v2/thread.rs:1362,1650 |
| 退订 | `thread/unsubscribe` | common.rs |

### 状态与审批
- `ThreadStatus`: `NotLoaded | Idle | SystemError | Active{active_flags}`（thread.rs:1628-1637）；`ThreadActiveFlag: WaitingOnApproval | WaitingOnUserInput`（:1642-1645）
- **审批是服务器→客户端的 JSON-RPC 请求**（server_request_definitions!, common.rs:1682-1710）：
  - `item/commandExecution/requestApproval`（decision: accept / acceptForSession / acceptWithExecpolicyAmendment / applyNetworkPolicyAmendment / decline / cancel，item.rs:62-81）
  - `item/fileChange/requestApproval`（accept / acceptForSession / decline / cancel）
  - `item/tool/requestUserInput`
- 推送通知：`thread/started`、`thread/status/changed`、`turn/started`、`turn/completed`（Turn.status=Completed/Interrupted/Failed/InProgress）、`item/started|completed|agentMessage/delta`、`item/commandExecution/outputDelta`、`error`（common.rs:1833-1954）
- 结果：`turn/completed` 带最终 turn；`thread/read{includeTurns:true}` 全量回读

## 2. OpenCode Server（REST + SSE）

### 传输与启动
- `opencode serve [--port 4096] [--hostname 127.0.0.1]`；OpenAPI 3.1 spec 在 `/doc`；`OPENCODE_SERVER_PASSWORD` basic auth
- SSE：`GET /event`（首个事件 `server.connected`，之后为事件总线流）、`GET /global/event`（全局流）

### 关键端点（Worker Adapter 所需最小集）

| 用途 | 端点 | 备注 |
|---|---|---|
| 会话列表 | `GET /session` | 支持 directory 过滤 |
| 建会话 | `POST /session` | `{parentID?, title?}` |
| 状态 | `GET /session/status` | `{sessionID: {busy|idle|…}}` |
| 发任务（同步） | `POST /session/:id/message` | `{parts:[{type:'text',text}], model?, agent?}`，等待完成 |
| 发任务（异步） | `POST /session/:id/prompt_async` | 204，配合事件流 |
| 追加提问 | `POST /session/:id/message` | 同端点续发 |
| 取消 | `POST /session/:id/abort` | |
| **审批回复** | `POST /session/:id/permissions/:permissionID` | `{response, remember?}` |
| 结果/变更 | `GET /session/:id/message`、`GET /session/:id/diff` | FileDiff[] |
| 命令/Shell | `POST /session/:id/command`、`/shell` | 斜杠命令与直接 shell |

### 事件（插件事件列表，SSE 同名）
`session.created/updated/idle/error/status`、`message.updated`、**`permission.asked` / `permission.replied`**、`server.connected`、`tool.execute.before/after`、`todo.updated`（docs/plugins 事件清单）

### 权限模型
- `allow / ask / deny` 三态；模式匹配（`git *`、`rm *`）last-match-wins；支持 agent 级覆盖；`external_directory` 与 `doom_loop` 守卫；`--auto` 模式自动批准非 deny 项
- "ask" 的用户选择：once / always / reject
- 远程回复走 `POST /session/:id/permissions/:permissionID`（这正是 Hub 转发审批的官方通道）

## 3. 对比结论

| 维度 | Codex app-server | OpenCode Server |
|---|---|---|
| 协议 | 仿 JSON-RPC 2.0（stdio/unix socket/ws） | REST + OpenAPI 3.1 + SSE |
| 会话模型 | thread/turn/item 三层 | session/message/part 三层 |
| 等待用户信号 | ThreadStatus.Active{WaitingOnApproval, WaitingOnUserInput} | `permission.asked` / `question` 事件 + session 状态 |
| 审批通道 | 服务器→客户端 JSON-RPC 请求，回复 decision 枚举 | REST 回复 permissions/:id |
| 取消 | turn/interrupt | /abort |
| 结果 | turn/completed + thread/read | message 列表 + /diff |
| 官方 SDK/参考实现 | `app-server-client` crate | 官方 SDK（sdk-js，OpenAPI 生成） |
| 适配器可行性 | ✅ 可行（无需解析 CLI stdout；CLI 本身就是该协议的客户端） | ✅ 可行（无需终端模拟；官方支持 headless serve + async prompt） |

## 4. AgentWorker 接口概念设计（仅概念，不实现）

两端协议差异由 Adapter 屏蔽，Worker Manager 只面向统一接口：

```text
AgentWorker
├── startTask(project, task, grant) -> executionId
│      Codex: thread/start + turn/start(userInput=任务描述)
│      OpenCode: POST /session?directory + POST /session/:id/message
├── getStatus(executionId) -> QUEUED|RUNNING|WAITING_FOR_USER|WAITING_FOR_APPROVAL|RESULT_AVAILABLE|FAILED|CANCELLED
│      Codex: thread/status/changed 通知 + ThreadStatus.Active flags
│      OpenCode: GET /session/status + session.* 事件
├── subscribeEvents(executionId) -> event stream（状态变化/审批请求/输出增量）
│      Codex: item/* 通知流
│      OpenCode: /event SSE
├── respondToApproval(executionId, approvalId, decision)
│      Codex: 回复 item/commandExecution/requestApproval（decision 枚举）
│      OpenCode: POST /session/:id/permissions/:permissionID
├── respondToQuestion(executionId, questionId, answer)   ← 待验证项（见 §4.1）
│      Codex: item/tool/requestUserInput 的响应通道
│      OpenCode: question 类事件的回复通道（需运行时验证）
├── sendFollowup(executionId, text)   // 用户主动追加指令（区别于回答问题）
│      Codex: turn/steer
│      OpenCode: POST /session/:id/message
├── cancel(executionId)
│      Codex: turn/interrupt
│      OpenCode: POST /session/:id/abort
└── getResult(executionId) -> {summary, diff, tests, artifacts, evidence}
       Codex: thread/read(includeTurns)
       OpenCode: GET /session/:id/message + /diff
```

### 4.1 sendFollowup vs respondToQuestion（协议待验证项）

两类交互不能默认合并：

- **A. 用户主动追加指令**（user-initiated follow-up）：`sendFollowup()`。
  - Codex：`turn/steer`（turn.rs:180-202）✓ 已确认。
  - OpenCode：`POST /session/:id/message` ✓ 已确认。
- **B. Worker 主动提出结构化问题并等待回答**（worker-initiated question）：
  - Codex：`item/tool/requestUserInput` + `ThreadActiveFlag::WaitingOnUserInput`（common.rs:1682-1710、thread.rs:1642-1645）✓ 协议存在；**响应通道需在接入阶段实测确认**（与 approval 类似的 server→client 请求回复，还是通过 turn/steer 输入）。
  - OpenCode：存在 question 类事件与 permission.asked（plugins 事件清单）；**question 的回复端点需以 `/doc` OpenAPI 与运行时实测确认**（可能是 permission 回复端点复用，也可能是 message 续发）。
- 结论：概念接口拆为两个（`sendFollowup` 与 `respondToQuestion`），V0.1 不实现；接入真实 Worker 前的运行时协议验证已列入 Architecture Gates（见 HUB_ARCHITECTURE_REVIEW_V2.md §F）。

配套基础设施（借鉴 codelight 方法论）：
- session 状态表带 TTL（事件超时老化，防假 RUNNING）
- "需要用户介入"一律以 agent 主动事件（permission/question/requestApproval/requestUserInput）为准，轮询仅作兜底
- 长生命周期：executionId 与 Codex threadId / OpenCode sessionID 的映射持久化，支持重启恢复（Codex thread/resume；OpenCode 会话持久在服务端）
