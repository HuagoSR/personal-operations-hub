# 发布政策（RELEASE_POLICY）

- 适用版本：v0.1.0（Release Engineering R0 — Portable Deployment）
- 目标：一台符合要求的新 Linux 服务器，仅凭 README/安装手册即可安装 Hub；已有用户可迁移旧数据并恢复 Gateway / Intelligence / Codex Worker。

## 1. 发布边界（什么进入 Release / 什么不进入）

| 组件 | 处理方式 |
|---|---|
| Hub Core / Control Web / Gateway collector / Codex Worker adapter / Intelligence | **随 Release 发布**（源码 + 配置模板） |
| `thisnick/agent-wechat` | 第三方外部依赖：**不打包、不重新分发**；固定已验证 image（tag@digest），见 `THIRD_PARTY.md` |
| Codex CLI | 外部前置依赖：不打包；用户自安装自登录 |
| Docker | 微信集成外部前置依赖 |
| DeepSeek | 可选外部 API |
| 用户数据 / DB / token / 凭据 / 二维码 / 截图 / 日志 | **永不进入 Release** |

## 2. 支持矩阵（v0.1.0 正式承诺）

- 操作系统：Ubuntu 22.04 / 24.04 LTS，x86-64，单用户，systemd
- Node.js ≥ 22.13；bubblewrap；tar/rsync/sha256sum
- 外部前置：Codex 已安装并登录（v0.1.0 硬要求）
- 可选集成：Docker + agent-wechat（微信）；DeepSeek（Intelligence）
- 硬件（开发目标，clean-room 实测后定稿）：
  - 最低开发目标：≥2 vCPU / ≥4 GB RAM / ≥20 GB 空闲磁盘
  - 推荐：4+ vCPU / 8 GB RAM / 40 GB 空闲磁盘

## 3. Release 制品

- `personal-operations-hub-v0.1.0.tar.gz` + `SHA256SUMS`（GitHub Release）
- **不包含**：research/（阶段报告）、运行 DB、spool、logs、secrets、agent-wechat 第三方代码/镜像、Codex、开发工作副本、开发辅助脚本（deploy.ps1 等）、legacy wrappers（start/stop/status.sh，hubctl 接管后废弃）
- **包含**：hub/（代码+tests+运维脚本白名单）、gateway/（源码+运维脚本）、deploy/（compose+service 模板）、docs/（含 manuals）、VERSION、THIRD_PARTY.md、RELEASE_POLICY.md、README、LICENSE
- 源码仓与制品剪枝分离：enforcement-test.sh 等安全/发布验证资产保留在源码仓（Release Gate 资产），可不进最小 runtime 制品

## 4. 发布流程（固定顺序，全绿才可发布）

```
1. npm test（全量测试）
2. gateway/scripts/check-readonly.sh（只读不变量静态检查）
3. portable-path scan（无个人用户名硬编码路径）
4. secret scan（wxid/sk-/token/私钥 0 命中）
5. 构建 release artifact（排除清单见 §3）
6. clean-room smoke（全新 Ubuntu：onboard → doctor → 启动 → Web/Worker/可选集成 smoke）
7. 生成 SHA256SUMS
8. tag v0.1.0 + GitHub Release
```

## 5. 版本与升级

- 版本号单一来源：`VERSION` 文件 + `hub/package.json`
- 迁移/升级流程：`docs/manuals/MIGRATION.md` / `UPGRADE.md`（R0-D 产出）；备份/恢复用 SQLite 一致性快照（`VACUUM INTO` 等），**禁止复制运行中的 WAL DB**
- 老布局兼容：`hubctl doctor` 对 legacy 路径输出 `Data layout: LEGACY_COMPAT / Status: OK`，不告警

## 6. 安全基线（Release Gate 不可绕过）

- 微信永久只读 = System Invariant（WECHAT_WRITE = FORBIDDEN；check-readonly.sh 是验证门之一）
- Docker socket 永不暴露 Worker；容器操作只经白名单
- 秘密不进仓库/制品；日志脱敏；端口仅 127.0.0.1

## 7. 阶段划分（R0-A ~ R0-F）

- R0-A 发布边界与依赖冻结（本文件 + VERSION + THIRD_PARTY + 审计报告）
- R0-B 可移植性加固（路径模型 + 兼容层 + codex 发现 + systemd 模板化）
- R0-C `hubctl` + Bootstrap
- R0-D Doctor / Backup / Restore / 运维手册
- R0-E clean-room 部署与迁移实测（含 rollback 演练）
- R0-F Release Candidate → v0.1.0（制品 + SHA256 + GitHub Release）
