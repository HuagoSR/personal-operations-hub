# Personal Operations Hub

一个长期运行的个人工作/信息枢纽 Agent：持续接收外部信息（首个信息源为普通微信群，作为**永久只读的信息源**——不发送消息、不作为控制渠道），理解与用户相关的内容，整理为事件与潜在任务，经用户批准后把工程任务交给专业 Coding Agent（Codex）执行。Hub 负责协调、追踪、询问、汇报，不亲自承担编程工作。

## Release Status

Current release: **v0.1.0**（2026-09-08 发布；clean-room 实测通过）

发布边界与制品清单见 `docs/RELEASE_POLICY.md`。

## Quick Start

```bash
# 0. 前置自检（不满足 → 见 docs/manuals/INSTALLATION.md）
node --version          # >= 22.13
codex --version
codex login status

# 1. 系统依赖
sudo apt-get update && sudo apt-get install -y bubblewrap rsync tar curl

# 2. 下载 Release 制品（校验 SHA256）
mkdir -p ~/pohub && cd ~/pohub
curl -LO https://github.com/HuagoSR/personal-operations-hub/releases/download/v0.1.0/personal-operations-hub-v0.1.0.tar.gz
curl -LO https://github.com/HuagoSR/personal-operations-hub/releases/download/v0.1.0/SHA256SUMS
sha256sum -c SHA256SUMS

# 3. 解压并初始化（交互式：系统检查 → Codex 校验 → 目录规划 → 服务安装并启动）
tar -xzf personal-operations-hub-v0.1.0.tar.gz
cd hub
node bin/hubctl.js onboard

# 4. 校验（此后统一使用 hubctl 命令）
hubctl doctor     # 期望 READY
```

**访问 Control Web** —— 注意命令执行位置：

```text
# 服务器上：
hubctl status

# 你的本地电脑上：
ssh -L 8300:127.0.0.1:8300 user@your-server
```

然后在本地浏览器打开：http://127.0.0.1:8300

完整安装手册：`docs/manuals/INSTALLATION.md`。

## Requirements

| 项目 | 最低 / 当前支持基线 |
|---|---|
| OS | Ubuntu 22.04 / 24.04 LTS（x86-64，单用户，systemd） |
| CPU | ≥ 2 vCPU |
| RAM | ≥ 4 GB |
| Disk | ≥ 20 GB 可用空间 |
| Node.js | ≥ 22.13 |
| Sandbox | bubblewrap |
| Worker | 已安装并登录的 Codex CLI |
| Network | 能访问所需模型 API 与软件源 |

> 硬件基线（2026-09-08 clean-room 实测通过：Ubuntu 22.04 / 2 vCPU / 1.9 GB RAM）：最低 ≥2 vCPU / ≥2 GB RAM / ≥20 GB 可用空间；推荐 4+ vCPU / 8 GB RAM / 40 GB+。

可选：Docker + agent-wechat（微信集成）；DeepSeek API（Intelligence）。

## Components

| 组件 | 状态 | 说明 |
|---|---|---|
| `hub/` | always | Hub Core（SQLite 状态机 + 事务 Outbox + 幂等 Dispatcher）+ Control Web + `hubctl` CLI |
| Codex Worker | available | 需满足前置条件（已安装并登录的 Codex CLI） |
| `gateway/` | optional | 微信只读采集 Gateway（需 Docker + agent-wechat） |
| Intelligence | optional | live shadow 分析（需 DeepSeek API key） |
| `deploy/` | optional | agent-wechat Docker 编排（127.0.0.1:6174，固定验证镜像） |
| `docs/manuals/` | always | 安装 / 迁移 / 备份恢复 / 升级 / 运维 / 故障排查 / 微信手册 |

数据与代码分离：配置 `~/.config/personal-operations-hub/`，数据 `~/.local/share/personal-operations-hub/`，全部可用环境变量覆盖。

## Codex Worker

v0.1.0 要求用户**预先安装并登录 Codex**。Hub 只做自动发现（`codexBinary` 可覆盖）与 `hubctl doctor` 校验（version / login / app-server），不代办安装与认证。

## WeChat Integration

微信采集依赖第三方容器 `thisnick/agent-wechat`（**不打包、不重新分发**；截至 v0.1.0 发布准备阶段，上游仓库未声明明确 LICENSE——权威记录见 `THIRD_PARTY.md`；使用固定验证镜像 digest）。启用后按 `docs/manuals/WECHAT_LOGIN_GUIDE.md` 完成登录。微信作为**永久只读的信息源**，不发送消息、不作为控制渠道。

## Intelligence

可选功能（默认关闭）：对进入 Inbox 的消息做实时 shadow 分析（sender/chat 身份在模型输入中使用 episode 内匿名标识；敏感 chat 可配置为禁止出站；预算 $0.5/日 + $5/月硬上限），只给建议不自动执行（自动化等级 L3 封顶）。Provider：DeepSeek（外部 API，用户自备 key，写入 secret 文件，不入仓库）。

## Migration

旧机 `hubctl backup`（`VACUUM INTO` 一致性快照）→ 新机同版本安装 → `hubctl restore` → 重配 secrets → 微信重登 → `hubctl doctor`。

详见 `docs/manuals/MIGRATION.md` 与 `docs/manuals/BACKUP_RESTORE.md`。

## Security

- 微信永不发送、永不作控制渠道（WECHAT_WRITE = FORBIDDEN）
- Worker 全部经 bwrap 沙箱 + ExecutionGrant（ALLOW/ASK/DENY）；Docker socket 永不暴露 Worker
- 所有端口仅 127.0.0.1；远程访问走 SSH 隧道
- 秘密不入仓库/制品；日志脱敏；备份不含 secrets 与登录态

详见 `docs/SECURITY_MODEL.md`。

## Documentation

- 架构 / 决策 / 可靠性 / 路线：`docs/`（ARCHITECTURE / DECISIONS / RELIABILITY_MODEL / SECURITY_MODEL / RELEASE_POLICY）
- 操作手册：`docs/manuals/`（共 8 件）
- 运维总览：`docs/manuals/HUB_OPERATIONS_MANUAL.md`

## Third-party Dependencies

`THIRD_PARTY.md`（agent-wechat / Codex CLI / DeepSeek / Docker 的用途、许可与验证版本）。
