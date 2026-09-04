# Personal Operations Hub

一个长期运行的个人工作/信息枢纽 Agent：持续接收外部信息（首个信息源为普通微信群，**永久只读**），整理为事件与潜在任务，经用户批准后把工程任务交给专业 Coding Agent（OpenCode / Codex）执行。Hub 本身负责协调、追踪、询问、汇报，不亲自承担编程工作。

```
Sources（微信 → 未来 Email/GitHub/Calendar）
  ↓
Hub Core（Event / Inbox / TaskCandidate / Approval / ExecutionGrant / Outbox / 审计）
  ↓
Worker Manager
  ├── OpenCodeWorker（适配器就绪，上游目录回归待解锁）
  └── CodexWorker（端到端已验证）
  ↓
Sandbox / 项目（受 ExecutionGrant + Enforcement 约束）

Intelligence（Analysis Plane，live shadow）：Inbox 消息 → Episode → LLM 分析 → append-only 建议
```

## 组件

| 目录 | 说明 |
|---|---|
| `gateway/` | 微信只读 Gateway：官方微信容器 → agent-wechat → 只读采集（GET-only，2s 轮询 + cursor + 按日 spool） |
| `hub/` | Hub Core：SQLite 业务状态机 + 事务 Outbox + 幂等 Dispatcher + Intelligence（live shadow）+ Control Web（Node.js 零依赖） |
| `deploy/` | agent-wechat Docker 编排（127.0.0.1:6174） |
| `docs/` | 架构 / 决策 / 可靠性模型 / 操作手册（`docs/manuals/`：Gateway 手册、微信登录手册） |

## 运行

```bash
# VPS 上（系统化部署细节见 hub/README.md）
systemctl --user start wechat-gateway
systemctl --user start personal-hub
# Control Web：http://127.0.0.1:8300（经 SSH Tunnel 访问：ssh -L 8300:127.0.0.1:8300 huago-cone）
```
