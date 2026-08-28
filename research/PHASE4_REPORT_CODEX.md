# Codex 运行时验证报告（PHASE4_REPORT_CODEX）

- 日期：2026-08-28
- 环境：VPS huago-cone；codex-cli **0.146.0**（app-server 同版本），ChatGPT 登录（`codex login status` = Logged in using ChatGPT）
- 验证通道：`codex app-server --listen ws://127.0.0.1:8765`（自管进程，WebSocket 传输，Node 原生 WebSocket 客户端）+ JSON-RPC（`jsonrpc` 头省略）
- 结论：**PASS**——CodexWorker 所需协议能力全部实测可用。

## 1. 验证矩阵

| # | 项目 | 结果 | 要点 |
|---|---|---|---|
| 1 | 启动/健康 | ✅ | `--listen ws://127.0.0.1:8765`；`/readyz` `/healthz` 200；绑 localhost |
| 2 | initialize/initialized | ✅ | result: userAgent/codexHome/platformFamily/platformOs；同连接重复 initialize 会报 Already initialized |
| 3 | thread/start | ✅ | **thread id 在 `result.thread.id`**（不是顶层 threadId）；cwd+title；自动订阅事件 |
| 4 | turn/start | ✅ | `{threadId, input:[{type:'text',text}]}`；result.turnId 为空、turn 在 `turn/started` 通知里 |
| 5 | 事件流 | ✅ | thread/started、turn/started、thread/status/changed、item/started、item/completed、item/agentMessage/delta、item/commandExecution/outputDelta、thread/tokenUsage/updated、turn/completed |
| 6 | **审批流** | ✅ | 触发条件见 §3；`thread/status/changed` → `status.active.activeFlags=["waitingOnApproval"]`；服务端请求 `item/commandExecution/requestApproval`（含 threadId/turnId/itemId/command/cwd/reason/commandActions/additionalPermissions）→ 客户端以 `{result:{decision:"accept"}}` 回复 → 命令执行 → `serverRequest/resolved` |
| 7 | 决策枚举 | ✅ | accept / acceptForSession / acceptWithExecpolicyAmendment / applyNetworkPolicyAmendment / decline / cancel（文件类无 execpolicy 变体） |
| 8 | 沙箱与策略参数 | ✅ | turn/start 支持 `approvalPolicy`（枚举实测报错揭示：**untrusted / on-request / granular / never**）与 `sandboxPolicy: {type:"workspaceWrite", writableRoots:[...], networkAccess:false}` |
| 9 | 真实修复任务 | ✅ | 未信任目录 + 修复 subtract bug + npm test → 5/5 通过；final_answer 中文总结 |
| 10 | interrupt | ✅ | `turn/interrupt {threadId, turnId}` → `{}`；turn/completed status=**interrupted** |
| 11 | thread/resume | ✅ | 返回同 thread/start；支持同款策略覆写 |
| 12 | thread/read | ✅ | `{threadId, includeTurns:true}` → thread.turns[]（含 status） |
| 13 | 恢复能力 | ✅（推断+部分实测） | 会话落盘 `~/.codex/sessions/YYYY/MM/DD/`；thread/resume 跨连接可恢复（同一 app-server 进程内实测；进程重启恢复属同一存储路径，Worker 阶段补测） |
| 14 | thread/list | ⚠️ | 参数形态未对齐（`{limit:5}` 返回 0 条）——Worker 用 thread/read by id 即可，列表筛选留后续 |

## 2. 关键协议事实（与旧调研的差异）

1. **JSON-RPC 应答方向与调研一致**：审批是服务器→客户端的带 id 请求，客户端用 result 回复（不是独立方法调用）。
2. **turn id 从通知获取**：turn/start 的 result 不含 turnId；以 `turn/started` 通知里的 turn.id 为准（interrupt 需要它）。
3. `thread/status/changed` 的 `activeFlags`（`waitingOnApproval` / `waitingOnUserInput`）是 Hub 侧 WAITING_FOR_APPROVAL / WAITING_FOR_USER 的**官方信号**。
4. item 类型：userMessage / reasoning / agentMessage（phase: commentary|final_answer）/ commandExecution / fileChange；`turn/completed` 的 turn.items（itemsView=summary）带 final_answer 全文。
5. 中文 reason 文案自动生成（审批 UI 可直接展示）。

## 3. 审批触发机制（重要，Worker 设计依据）

- **trusted 目录静默放行**：thread/start 带 cwd 且沙箱为 workspace-write/full-access 时，app-server 会把该 cwd 写入 `~/.codex/config.toml` 的 `[projects."<cwd>"] trust_level="trusted"`，此后该目录的审批被跳过。**Worker 必须使用未被信任的目录**（或主动重置 trust），否则 ASK 语义失效。
- `approvalPolicy: "on-request"` 单独不触发审批；**当 sandboxPolicy 限制与命令冲突时（实测 networkAccess:false + curl）才发出 requestApproval**（reason 自动说明冲突点）。
- 全局 `~/.codex/config.toml` 当前 `sandbox_mode="danger-full-access"`（CLI 默认）；Worker 必须**显式传 sandboxPolicy**，不依赖全局配置。

## 4. 与 ExecutionGrant 的映射（Worker 实现设计输入）

| Grant 维度 | Codex 机制 |
|---|---|
| workspace | thread/start cwd + `sandboxPolicy.writableRoots=[cwd]`；读边界由 workspace-write 沙箱保证（越界读在 execpolicy 层触发审批） |
| network ALLOW/ASK/DENY | `sandboxPolicy.networkAccess: true/false` + approvalPolicy on-request（false+联网命令 → requestApproval → Hub 按 Grant 决定 accept/decline） |
| sudo/system_config | 沙箱内不可用；danger-full-access 由 Worker 永不启用 |
| git_push（L4） | 通过 commandActions 内容做 Hub 侧高风险分类（独立于 Grant 的 L4 人工确认） |

## 5. 遗留

- thread/list 参数形态待查（不影响 V0.1 Worker）。
- requestUserInput（tool 提问）未实测触发（枚举存在）；入阶段八补测清单。
- app-server 进程重启后 thread/resume 的完整恢复需在 Worker 集成阶段实测。
- ws 传输官方标 experimental；Worker 采用 ws://127.0.0.1（本地回环），备用方案为 proxy+stdio（需自实现 WS 帧）。
