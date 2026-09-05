# 第三方依赖（THIRD_PARTY）

Personal Operations Hub v0.1.0 的外部依赖清单。除 Hub 自身代码外，以下组件**不打包、不重新分发**；由用户在目标机器上按各自方式获取与管理。

## 1. thisnick/agent-wechat（微信后端）

| 项 | 值 |
|---|---|
| Purpose | WeChat 只读采集后端（微信客户端容器 + agent-server + 只读 API） |
| Bundled | **No**（外部拉取） |
| License | 上游在 v0.1.0 发布准备时**无明确 LICENSE**（使用需自担风险） |
| Source | `https://github.com/thisnick/agent-wechat`（上游 commit f72e7552，2026-05 后无实质更新） |
| Validated version / image | `ghcr.io/thisnick/agent-wechat@sha256:31a4e351c191bcbfc75e5c10be51e207d22a3eedd97f3ff56ad579fcce717b24`（2026-08/09 在 Ubuntu 22.04 x86_64 + Docker 29.7 实测：读取/采集/故障注入 F1–F5 通过） |
| 使用要求 | Docker；容器需 `SYS_PTRACE` + `seccomp=unconfined`（登录态 DB key 提取的固有设计，风险已记录于 docs/manuals/WECHAT_GATEWAY_MANUAL.md） |
| 登录/运维 | 见 `docs/manuals/WECHAT_LOGIN_GUIDE.md`；微信消息**永久只读**（WECHAT_WRITE = FORBIDDEN 系统不变量） |

## 2. OpenAI Codex CLI（编码 Worker）

| 项 | 值 |
|---|---|
| Purpose | Coding Worker 执行面（读码/改码/测试/git/shell，经 bwrap 沙箱） |
| Bundled | **No**（外部前置依赖） |
| License | 用户按其自身条款使用 |
| Authentication | **用户自管理**（Hub 不代为安装或登录；v0.1.0 要求用户已完成 `codex login`） |
| Validated version | `codex-cli 0.146.0`（2026-09-04 实测） |
| 发现策略 | Hub 启动时 `command -v codex` 自动发现，可用 `codexBinary` 配置覆盖；`hubctl doctor` 校验 version/login/app-server |

## 3. DeepSeek API（可选：Intelligence Provider）

| 项 | 值 |
|---|---|
| Purpose | 可选 Intelligence（live shadow 分析，默认关闭） |
| Bundled | **No**（外部 API） |
| Validated model | `deepseek-chat`（schema 校验 100%、requires_action F1=1.0，2026-09 语料基线） |
| 凭据 | 用户自备；写入 `HUB_CONFIG_DIR` 下 secret 文件（chmod 600），**绝不进入仓库/发布包** |
| 数据出站 | 仅 Inbox 内容 + 匿名化身份 + 敏感 chat 禁出站（政策 D023）；预算 $0.5/日 + $5/月硬上限 |

## 4. Docker（可选：微信集成外部前置）

| 项 | 值 |
|---|---|
| Purpose | 运行 agent-wechat 容器 |
| Bundled | **No** |
| Validated version | Docker 29.7 + Compose v5.3（2026-08/09 实测） |

## 5. 其余运行依赖（系统级，非第三方软件包）

- 操作系统：Ubuntu 22.04 / 24.04 LTS（x86_64）
- Node.js ≥ 22.13（`node:sqlite` 内置）
- bubblewrap（Worker 沙箱）、systemd（服务托管）
- `rsync` / `tar` / `sha256sum`（apply/rollback 与备份流程）
