# 升级手册（UPGRADE）

- 适用范围：同一台机器、相同数据布局的版本升级（迁移到新机器见 MIGRATION.md）

## 1. 升级前

```bash
node bin/hubctl.js doctor                 # 基线：READY 或已知 DEGRADED 项记录在案
node bin/hubctl.js backup                 # 必须：升级前一致快照
node bin/hubctl.js version                # 记录当前版本
```

## 2. 部署新版本

```bash
# 方式 A：替换制品（推荐，正式 release）
cd ~/pohub
tar -xzf personal-operations-hub-v<new>.tar.gz   # 覆盖代码
cd hub && node bin/hubctl.js version              # 确认新版本

# 方式 B：开发期 deploy（Windows 本机 → VPS）
powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1
```

## 3. 迁移与验证

```bash
node bin/hubctl.js start                     # 启动时自动跑 schema migrations（只进不退）
node bin/hubctl.js doctor                    # 期望 READY；若 schema 不匹配 → 见下
```

- migration 只允许前进：`hubctl restore` 的降级保护会拒绝"备份 schema > 当前代码"的场景
- 验证清单：Inbox / 会话时间线 / Tasks / Results / 智能分析 / apply 历史均可读；Web 200；gateway 采集正常

## 4. 回滚（升级失败时）

```bash
node bin/hubctl.js stop
node bin/hubctl.js restore <升级前备份>.tar.gz --force   # release 必须匹配 → 需先换回旧版代码
# 即：回滚 = 先恢复旧版本代码，再 restore 旧备份
cd ~/pohub && tar -xzf personal-operations-hub-v<old>.tar.gz
cd hub && node bin/hubctl.js restore /path/old-backup.tar.gz --force
node bin/hubctl.js doctor && node bin/hubctl.js start
```

Hub Self 应用（apply-hub.sh / rollback-hub.sh）是同一机制的另一入口：apply 前脚本已自动备份，rollback 见 `docs/manuals/HUB_OPERATIONS_MANUAL.md`。

## 5. 版本策略

- 单一版本来源：仓库根 `VERSION` 与 `hub/package.json`
- 迁移只在"备份已存在 + doctor 基线已记录"后进行；发布流程见 `docs/RELEASE_POLICY.md`
