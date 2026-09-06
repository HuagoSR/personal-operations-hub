# 备份与恢复手册（BACKUP_RESTORE）

## 1. 备份

```bash
node bin/hubctl.js backup                    # 默认目标：$HUB_BACKUP_DIR 或 <dataDir>/../backups
node bin/hubctl.js backup --with-gateway     # 附加 gateway cursor/dedup/health
node bin/hubctl.js backup --db /path/hub.db --out /custom/dir
```

- 产物：`hub-backup-YYYYMMDD-HHMM.tar.gz`
- 内容：`manifest.json` + `hub.db`（**`VACUUM INTO` 一致性快照**，服务运行中也安全——绝不允许用 `cp` 复制 WAL 数据库）+ `VERSION` +（可选）`gateway-state/`
- 打包前对快照执行 `PRAGMA integrity_check`，失败即中止
- **永不入包**：SSH keys、Codex 凭据、DeepSeek key、微信 DB key、二维码、截图、日志、spool 全文

### manifest.json 结构

```json
{
  "release": "0.1.0",
  "schema_version": 8,
  "created_at": "...",
  "source_host": "...",
  "components": { "hub": "v0.1.0", "gateway": "included" },
  "db_file": "hub.db",
  "snapshot_method": "VACUUM INTO"
}
```

### 建议节奏

- 每日自动备份（cron/systemd timer）：`hubctl backup`
- 任何 apply（Hub Self 更新）前：`hubctl backup`
- 任何 migration 前：`hubctl backup`

## 2. 恢复

```bash
node bin/hubctl.js stop                          # 恢复前停服（运行中会拒绝，除非 --force）
node bin/hubctl.js restore <backup.tar.gz> [--with-gateway] [--force]
node bin/hubctl.js doctor
node bin/hubctl.js start --all
```

- 校验：manifest release 必须与当前版本一致；`schema_version` 必须为整数且**不高于当前代码 migrations**（降级保护）
- 原库自动改名留底：`hub.db.pre-restore-<stamp>`
- 恢复后自动校验 schema_migrations 版本并打印
- gateway-state 需 `--with-gateway` 才会写回（原文件同样留底）

## 3. 回滚演练（周期性）

1. 停服 → 备份 → 制造一次错误恢复（错误 release 的包被拒 / 停服恢复演练）
2. 用正确包 `hubctl restore` → `doctor` = READY → 起服
3. 演练结论记录在运维日志；**回滚路径不依赖 Hub 自身存活**

## 4. 边界与限制

- 备份 = 数据库 + gateway 状态 + 元数据；**不含 secrets 与微信登录态**（重配/重登，见 MIGRATION.md）
- 跨版本恢复不允许（release 不匹配即拒绝）；升级场景走 UPGRADE.md 的"先备份再迁移"路径
