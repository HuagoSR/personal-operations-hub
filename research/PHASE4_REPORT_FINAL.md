# Phase 4 最终报告（PHASE4_REPORT_FINAL）

- 日期：2026-08-28
- 输入：PHASE4_PLAN（十三阶段）+ 四个运行时/设计报告（OPENCODE / CODEX / ENFORCEMENT）
- 结论：**READY_WITH_FIXES**（CodexWorker 闭环已跑通；OpenCodeWorker 被上游目录回归阻断；ASK 转发链部分完成）

---

## 一、阶段完成情况

| # | 阶段 | 状态 | 证据 |
|---|---|---|---|
| 1 | 封存 V0.1 | ✅ | git tag `v0.1-known-good`；VPS 归档 tar；GitHub 仓库建立 |
| 2 | Worker Sandbox + 诱饵 | ✅ | `~/worker-sandbox-untrusted/`（calc 项目带故意 bug + decoy-secrets + forbidden-zone） |
| 3 | OpenCode 运行时验证 | ✅（含后期回归） | 报告 PHASE4_REPORT_OPENCODE：session/prompt/permission.asked/reply/edit/bash 全链路实测通过（修复任务 5/5）；**17:40 后 models.dev 目录自动刷新导致 serve 模型解析回归**（详见 §三） |
| 4 | Codex 运行时验证 | ✅ | 报告 PHASE4_REPORT_CODEX：ws JSON-RPC 全链路 + requestApproval/accept + interrupt + thread/read 实测 |
| 5 | Enforcement Gate | ✅ | 报告 PHASE4_REPORT_ENFORCEMENT：bwrap 沙箱 8/8 测试 PASS（workspace/network/sudo/凭据隔离，命令级硬断网） |
| 6 | AgentWorker 抽象 | ✅ | `hub/src/workers/`（contract/interface/approval-policy + opencode/codex 适配器）；Hub Core 不感知底层差异 |
| 7 | OpenCodeWorker | ⚠️ 适配器完成，闭环被阻断 | 适配器代码完整（serve 沙箱启动/SSE/permission/question/result）；上游回归使 serve 模型调用失败（§三） |
| 8 | 长生命周期验证 | ⚠️ 部分 | 会话持久化 + resumeTask 实现；hub 重启恢复未完整实测（见 §四） |
| 9 | CodexWorker | ✅ | **Hub→Codex→Sandbox 完整闭环实测通过**（§二） |
| 10 | Worker Manager | ✅（最小版） | 按 execution.worker 路由（fake-worker/opencode/codex）；失败换 Worker 的 UI 流程已在 V0.1（request another execution） |
| 11 | 高风险审批链 | ⚠️ PARTIAL | 自动 ALLOW 链 PASS；ASK→WAITING_FOR_APPROVAL→用户裁决→转发 PASS（permission 状态 ALLOWED、审计完整）；**codex 收到 fileChange accept 后 turn 未续跑**（待排查回复格式/时序，见 §四） |
| 12 | 真实 Result | ✅ | codex 结果归一化（summary/diff/tests/evidence：threadId/turnId/fileChanges/commands）；Result 不可变 + 用户 Review 完成（task 21 COMPLETED） |
| 13 | Control Web 升级 | ✅（最小） | 既有 Tasks/Executions 页原生支持权限请求与提问（权限 ALLOW/ASK/DENY 决策按钮已复用） |

## 二、CodexWorker 端到端证据（2026-08-28 生产实测）

1. **修复闭环**：UserCommand → 候选 21 → approve(worker=codex) → Outbox → Dispatcher → bwrap 沙箱内 `codex app-server`（CODEX_HOME=私有 profile，auth.json 注入）→ thread/start+turn/start → fileChange+commandExecution → turn/completed → Result（summary 含修复说明）→ `npm test` 实测 **5/5 pass** → 用户 Review → COMPLETED。
2. **自动 ALLOW 链**：执行 23（curl 任务）：requestApproval → Hub 按 Grant(run_project_commands=allow) 自动 accept → permission_requests 落审计行（ALLOWED）→ 命令真实执行（HTTP 200 回传）。
3. **ASK 链**：执行 25（write_project=ask，readOnly 沙箱）：fileChange requestApproval → Hub 判定 ASK_USER → 执行状态 **WAITING_FOR_APPROVAL** + permission(OPEN) → 用户 API 裁决 allow → 转发 codex（permission→ALLOWED）→ 执行回 RUNNING。
4. 沙箱全程生效：worker 进程运行于 bwrap（workspace 隔离/宿主机敏感数据不可见/sudo 屏蔽）；codex 的 cwd 未被标记 trusted（approvalPolicy on-request + 未信任目录）。

## 三、OpenCode 阻断根因（如实记录）

- 14:04–15:20：宿主机 serve 全链路验证通过（含真实修复任务 5/5，报告已产出）。
- ~17:40 后：opencode **自动刷新 models.dev 目录**（`catalog.updated` 事件、models.json 更新为 v4 版），此后：
  - `deepseek-chat` → `ModelUnavailableError`（目录中已移除）
  - `deepseek-v4-pro`（目录已知）→ serve 发出的 LLM 请求**不带 Authorization 头**（经本地代理抓包 + DeepSeek 错误文案比对确认 "Authentication Fails (governor)" = 无 auth 头）
  - 自定义 provider/model（hub/ds）→ `ModelUnavailableError`
  - 同目录下 CLI `opencode run` 仍正常（PONG 实测）→ 回归限定在 serve 会话路径
- 已排查并排除：DeepSeek key 有效性（curl 直连 200）、沙箱网络（沙箱内 curl 200）、env 注入（/proc environ + /config 均确认）、node_modules 可写性、bwrap 隔离本身（宿主 serve 同样复现）。
- 判定：**上游回归（opencode 1.18.25 serve 会话模型解析 / models.dev 目录联动）**，需钉住已知好目录快照或等待上游修复；已提交 GitHub issue 检索确认社区同现象（#41325 等 headless 权限相关）。

## 四、遗留与待办（Phase 4 收尾清单）

1. **Codex fileChange accept 后 turn 续跑**：回复已送达（hub 侧 ALLOWED + WS result 已发）但 codex turn 未见继续；需抓 WS 回复回执与 codex 侧日志比对（疑似 reply 时序/格式细节）。
2. **Hub/Worker 重启恢复实测**：会话持久化（worker_profiles + 私有 profile 目录）已实现，SIGKILL 场景未在真实 Worker 上跑（FakeWorker 已验证）。
3. **故障测试矩阵**（计划 §十六）：部分完成——重复 dispatch/越权/断网在 FakeWorker+Enforcement 层已验；真实 Worker 层的 Hub crash while running 等 8 项待跑。
4. **OpenCode 解锁路径**：a) 钉 models.json 快照（备份当前已验证 CLI 可用的目录副本 + 禁自动刷新）；b) 或等上游修复；c) 或改用 opencode CLI run 模式（已验证可用）作为兜底适配器。
5. 权限 UI 已可用；Worker 实时输出流（delta 展示）未做——记录为后续项。

## 五、完成标准对照

| 标准 | 状态 |
|---|---|
| Hub→OpenCode→Sandbox 完整生命周期 | ❌（上游回归阻断，适配器就绪） |
| Hub→Codex→Sandbox 完整生命周期 | ✅ |
| Permission ALLOW/ASK/DENY 均验证 | ⚠️ ALLOW✅ ASK✅(到转发) DENY（enforcement 层已验，worker 链未专项跑） |
| Worker 提问→等待→回答→继续 | ⚠️ requestUserInput 通道已接（未实测触发） |
| Hub/Worker 重启可恢复 | ⚠️ 机制就绪，实测待补 |
| Sandbox 越权/网络/sudo 实测 | ✅ 8/8 |
| Result 不可变/可 Review/Worker 不能自证完成 | ✅ |

## 六、结论

**READY_WITH_FIXES**：Codex 线已达到"能控制、能审批、能等待、能恢复（机制）、能限制越权、能拿回结果"；OpenCode 线被上游目录刷新回归阻断（非本项目缺陷，适配器与全部协议验证已完成）。建议：完成 §四 待办 1/2/3 后对 Codex 线正式判定完成；OpenCode 按 §四.4 解锁路径跟进，解锁前 OpenCodeWorker 保持禁用。

**红线遵守**：全程仅操作 sandbox 项目；未触碰真实项目/真实凭据（仅注入 codex ChatGPT auth 副本至私有 profile）；未修改任何系统配置（bwrap 用户级）；Gateway/微信未受影响。
