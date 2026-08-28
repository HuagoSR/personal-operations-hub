# OpenCode 运行时验证报告（PHASE4_REPORT_OPENCODE）

- 日期：2026-08-28
- 环境：VPS huago-cone；opencode **1.18.25**（`~/.opencode/bin/opencode`，bun 运行时）；模型 provider=DeepSeek（`@ai-sdk/openai-compatible`，api.deepseek.com/v1）
- 结论：**PASS（带已知限制与 4 个关键踩坑）**——足以进入 OpenCodeWorker 实现。

## 1. 验证范围与结果

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 1 | 安装与 CLI 模型调用 | ✅ | `opencode run` 返回 PONG（DeepSeek 真实调用） |
| 2 | `opencode serve` REST + OpenAPI | ✅ | 127.0.0.1:4096 `/doc` 200；两套 API 面（v1 `/session` 与 v2 `/api/session`） |
| 3 | 创建 session（directory + 显式 model） | ✅ | POST `/api/session` → `{data:{id:ses_...}}` |
| 4 | 发送任务（prompt）与消息读取 | ✅ | POST `/api/session/:id/prompt`；GET `/api/session/:id/message`（含 tool part 状态/输出） |
| 5 | **permission ASK 全链路** | ✅ | bash 与 edit 的 `permission.v2.asked` → GET 详情 → POST `/api/session/:id/permission/:rid/reply` `{reply:"once"}` → `permission.v2.replied` → 工具真实执行 |
| 6 | 真实修复任务 | ✅ | 修复 sandbox calc 的 subtract bug → 独立复测 **5/5 测试通过** |
| 7 | 会话续用（同 session 多轮） | ✅ | 多轮 prompt 在同一 session 内继续 |
| 8 | interrupt/abort | ✅ | POST `/api/session/:id/interrupt` → 204 |
| 9 | serve 重启恢复 | ✅ | 会话与消息全部持久化（opencode.db）；重启后列表与消息完整 |
| 10 | diff | ⚠️ | v1 `GET /session/:id/diff` 存在但 sandbox 非 VCS 仓库返回 `[]`（diff 依赖 VCS；待 Worker 阶段用 git 目录复验） |
| 11 | question（结构化提问） | ⚠️ 未实测 | 回复端点 schema 确认存在（`/api/session/:id/question/:rid/reply`）；build agent 默认无触发场景，列 Phase 4 阶段八复验项 |
| 12 | 服务端密码保护 | ⚠️ | `OPENCODE_SERVER_PASSWORD` 支持 basic auth（生产接入时启用） |

## 2. 事件通道（关键机制）

- **`GET /global/event`（SSE）是 Worker 必须订阅的流**：事件为包装格式 `{"directory":...,"payload":{id,type,properties}}`。
- 事件类型实测：`server.connected/heartbeat`、`session.created`、`session.next.prompt.admitted/prompted`、`session.next.step.started/ended/failed`、`session.next.text.started/delta/ended`、`session.next.tool.input.started/delta/ended`、`session.next.tool.called/success/failed`、`permission.v2.asked`、`permission.v2.replied`、`sync`。
- `/event` 与 `/api/session/:id/event` 流不携带 permission 事件（仅 `/global/event` 有）——与旧调研文档不同。
- `permission.v2.asked.properties`：`{id: per_..., sessionID, action(bash/edit/...), resources[], save[], source{type,messageID,callID}}`。

## 3. 四个关键踩坑（Worker 实现必须处理）

1. **`.env` 不会被自动加载**（`~/.opencode/.env`、`~/.config/opencode/.env` 均无效）→ `{env:DEEPSEEK_API_KEY}` 解析为空导致 401。**解决**：启动 serve 的进程环境必须显式导出 `DEEPSEEK_API_KEY`（key 唯一存 `~/.opencode/.env` 600；Worker 的 systemd 单元用 `EnvironmentFile`）。
2. **session 默认模型漂移**：POST `/api/session` 不带 model 时会用服务器落库的旧默认（实测 `tencent-tokenhub/hy4-preview`，走 opencode 官方网关 → 401/ModelNotSelected）。**解决**：每次创建 session 显式传 `model:{id:"deepseek-chat",providerID:"deepseek"}`；全局配置加 `experimental.policies` deny `*` + allow `deepseek`（provider.use），根除官方网关依赖。
3. **非 TTY 的 `opencode run` 随机卡在 init**（service 场景不用 CLI，用 serve + API，可绕过）。
4. **headless 权限请求无任何轮询列表可用**（v1 `GET /permission` 与 v2 `/api/permission/request` 均返回空）→ **Worker 只能靠 `/global/event` 的 `permission.v2.asked` 事件**获取请求（已在流内确认可靠）。权限配置 `permission:{edit/bash/webfetch:ask}` 在全局 config 生效。

## 4. DeepSeek 平台事实（2026-08-28 实测）

- `GET /v1/models` 返回：deepseek-v4-flash / deepseek-v4-pro / deepseek-v4-flash-vision-exp；**`deepseek-chat` 已作为别名映射到 v4-flash**（请求 deepseek-chat 正常返回）。
- OpenAI 兼容 API 稳定；单条小请求成本极低。

## 5. 遗留风险

- `delivery:"steer"` 的续聊在 idle 会话上的行为需 Worker 阶段细化（建议 prompt 用 `delivery:"queue"` 并靠消息轮询判完成）。
- opencode 上游仍在快速演进（本报告钉 1.18.25）；Worker 侧协议字段需随升级回归。
- question 回复通道、VCS diff 需在阶段八补验。
