# 安全模型（SECURITY_MODEL）

## 1. 微信永久只读（已实施）

- 微信 = **Untrusted Read-Only Information Source**，永不具有发送能力。
- Gateway 对 agent-wechat 只发 GET；源码静态检查 `gateway/scripts/check-readonly.sh`（POST/send/open/logout 引用必须为空）。
- 禁止调用：`POST /api/messages/send`、`POST /api/chats/{id}/open`、`POST /api/status/logout`。
- 即使未来其他渠道可双向，也不代表微信需要发送能力。
- 理由：降低封号风险；避免误发；防止外部消息形成双向控制链；简化安全模型。

## 2. 外部消息均为不可信输入

- 任何来源（含微信）的消息只能形成 Information / Task Candidate。
- 消息内容不得被当作指令直接执行；LLM 输出同样需要经过批准流程。
- 例：群里出现"@我 删掉服务器 xxx"→ Hub 最多识别为潜在任务并汇报，绝不自动执行。

## 3. Hub 默认无 arbitrary shell

- Hub 拥有：消息库、事件库、任务库、Project Registry、Approval Manager、Worker Manager、Notification。
- Hub 不拥有：任意 shell、sudo、任意文件系统修改。
- 真正的文件/shell 能力属于 Worker，且仅在 Execution Grant 范围内。

## 4. Execution Grant（执行授权边界）

任务执行不是简单 YES/NO，而是结构化授权：

```json
{
  "project": "gomoku-ai",
  "worker": "codex",
  "permissions": {
    "read_project": true,
    "write_project": true,
    "run_tests": true,
    "network": false,
    "sudo": false,
    "git_push": false
  }
}
```

权限维度至少覆盖：read files / write files / run tests / run commands / network / install deps / git commit / git push / sudo / system config。

## 5. 四层审批与优先级

```
L1 Task Approval（人工）：TaskCandidate → Task
L2 Execution Grant（结构化）：权限边界签发/吊销
L3 Worker Tool Approval（半自动）：转发 Worker 原生审批
L4 High-risk Action（人工独立确认）
```

**优先级：L4 > L2 > L3 自动放行。ExecutionGrant 不是最高权限。**

即使 Grant 声明 `run_commands: true, network: true`，以下动作仍属 High-risk，必须再次人工确认：

```
sudo / git push / rm 与破坏性删除 / system configuration / credential access
```

决策流程（Hub 不重写 Worker 的工具审批协议，只做转发与自动决策映射）：

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

## 6. Project Registry

- Hub 不得"看到目录就操作"。只有已登记项目（或用户对当前任务明确批准的项目）才允许 Worker 访问。
- 概念形态（当前未实现）：

```yaml
projects:
  gomoku-ai: { path: /srv/projects/gomoku-ai, preferred_worker: opencode }
  shopping-cart: { path: /srv/projects/AutoFollowShoppingCart, preferred_worker: codex }
```

## 7. Human-in-the-loop

- 任务启动、权限授予、高风险动作均需人工批准。
- 审批请求带 TTL：过期后不能继续执行，并写审计事件。
- Grant 吊销：吊销后后续 Worker permission 不得继续自动放行（FakeWorker 阶段模拟验证）。

## 8. 完整审计链

- 持久记录：任务来源（origin）→ 判定理由 → 审批人/时间（Actor）→ Grant 内容 → 执行者 → 会话事件 → 结果。
- 审计载体：append-only event / transition log（entity/from/to/actor/reason/timestamp/metadata）。
- 日志隐私：chat/sender id 仅以 sha256 前 8 位出现；消息正文不进日志，只进 spool。
- 秘密数据（token、微信 DB key、完整 wxid、二维码、聊天原文）不进 Git。

## 9. ExecutionGrant Enforcement（已落地 bwrap 8/8；Hub Self 专项见 §11）

- ExecutionGrant 是**逻辑策略**，不等于 OS 安全边界。Worker 进程若运行在拥有整个 home 权限的 Unix 用户下，Grant 之外的数据（~/.ssh、~/.config、其他项目、secret）技术上仍可读。
- 已实现（Phase 4）：workspace 隔离、命令级硬断网（command-deny）、凭据隔离、sudo 屏蔽、/etc 只读——bwrap 用户级，无需 sudo。实测 8/8 PASS（`research/PHASE4_REPORT_ENFORCEMENT.md`）。

## 10. 现有系统边界（已实施）

- 端口只绑 127.0.0.1（6174 / 8300）；远程访问走 SSH Tunnel。
- 不修改宿主机 SSH/防火墙/systemd 系统级配置（除非用户明确批准）。
- 微信容器运行需 `SYS_PTRACE + seccomp=unconfined`（DB key 提取必需），风险已记录。

## 11. Hub Self Project 安全模型（Phase 6，D012–D014）

- Hub Self Project（`project_type=SYSTEM_HUB`）与 Global Hub 是两个**独立安全域**，永不合并。
- 开发工作区：`~/worker-sandbox-untrusted/hub-dev/`（隔离副本）；生产 checkout 对 Worker 不可见。
- 权限模板（系统默认，用户可收紧）：
  - dev 副本内：read/write/run_tests/install_deps **ALLOW**；git_commit **ALLOW**（hooks 审计、不推远程、commit 含 task id、hash 入 Result）
  - git_push / deploy / restart / 生产 DB mutation / Gateway 修改与重启：**ASK / HIGH_RISK**
  - 微信容器/微信数据/credentials/~/.ssh/sudo/system_config：**DENY 永远**
- 自我修改流程：副本修改 → 测试 → Result/Diff → 用户 Review → [Prepare Update] → 手动 [Apply Update]（备份→同步→重启→health check）→ 失败 rollback。
- **带外恢复 SOP**（不依赖 Hub）：SSH + known-good tag + `scripts/rollback-hub.sh` + systemd 重启；自动部署评估前必须演练通过（`research/PHASE6_HUB_SELF_PROJECT_DESIGN.md` §12）。

## 12. Hub Intelligence 安全模型（Phase 7 规划，D015–D022）

- 外部消息（微信及未来 Email/GitHub/Calendar）= **UNTRUSTED DATA**：消息内容永不是对模型的指令（prompt injection 防御：容器化 + 无工具 + 严格 JSON 校验链 + FAILED 不猜）
- Intelligence LLM 零权限：无 shell/文件/Worker/Codex/写 ExecutionGrant/无 Approval 决策/无凭据/无微信操作；产物只能是写入 append-only intelligence_analyses 的分析/分类/建议/置信度（D015）
- 任何状态变化必须经确定性 service + 原审批体系；自动化等级上限 L3（D016），Shadow Mode 先行（D017）
- Provider 抽象与数据出站授权分离（D018）：未获用户批准前**真实微信正文禁止发送给任何外部模型**（仅 synthetic/anonymized）；日志不记正文
- 微信只读 System Invariant（D019）：五层强制（API surface / workspace / 白名单 / check-readonly.sh / apply 门），任何 Grant/用户覆盖不能变 ALLOW
- Docker socket 永不暴露 Worker（D020）：容器操作只经 Gateway Ops Facade 白名单 + 用户 ASK
- Gateway 手册（docs/manuals/）带版本元数据，是受管理 Context Source（D021）
- 详细威胁分析见 research/PHASE7_THREAT_MODEL.md