# 迁移手册（MIGRATION）

- 场景：旧 VPS → 新 VPS（同版本 v0.1.0；异版本见 UPGRADE.md）
- 原则：**迁移包只含数据与非秘密配置；secrets 一律在新机重配**；出现任何"这个文件还得手动复制"的步骤 = 包装缺陷，必须补进工具或本手册。

## 1. 旧机：备份

```bash
cd ~/pohub/hub
node bin/hubctl.js doctor                    # 先确认 READY/DEGRADED（无 ACTION_REQUIRED）
node bin/hubctl.js backup --with-gateway     # VACUUM INTO 一致性快照 + manifest + gateway cursor/state
# 产物：<HUB_BACKUP_DIR>/hub-backup-YYYYMMDD-HHMM.tar.gz（记下路径）
```

迁移包内容：`manifest.json`（release/schema_version/created_at/source_host/components）+ `hub.db`（一致性快照）+ `VERSION` + `gateway-state/`（cursor/dedup/health）。
**明确不包含**：SSH keys、Codex 凭据、DeepSeek API key、微信 DB key、二维码、截图、日志、spool 全文。

## 2. 传输

```bash
scp <backup.tar.gz> user@new-host:/tmp/
```

## 3. 新机：安装同版本

按 INSTALLATION.md 完成 `hubctl onboard`（**先不启用微信登录**），确认 `hubctl doctor` 除数据外无 ACTION_REQUIRED。

## 4. 新机：恢复

```bash
# 先停服务（新机刚装可跳过）
node bin/hubctl.js stop
node bin/hubctl.js restore /tmp/<backup.tar.gz> --with-gateway --force
node bin/hubctl.js doctor                     # 期望 READY
```

恢复后校验（逐项确认）：
- [ ] Projects 列表完整（含 Hub 系统项目）
- [ ] Conversations / 时间线历史可见
- [ ] Tasks / Executions / Results 历史可见
- [ ] Intelligence 分析历史（Inbox 卡片仍带分析）与 feedback
- [ ] apply_requests（Hub Self）历史
- [ ] Gateway cursor 恢复（重启 wechat-gateway 后无重复采集）

## 5. 重配 secrets（新机）

- Codex：`codex login`（用户自管理）
- DeepSeek：写入 `HUB_CONFIG_DIR/secrets/intelligence.env`（600）
- 微信：**重新登录**（`docs/manuals/WECHAT_LOGIN_GUIDE.md`）——登录态不可迁移；手机端保持关闭"该设备自动登录"

## 6. 收尾

```bash
node bin/hubctl.js start --all
node bin/hubctl.js doctor    # READY
node bin/hubctl.js backup    # 新机立即留一份基线备份
```

## 7. 回滚演练（必须）

迁移完成后人为演练一次：制造错误（如恢复一个错误备份的 manifest 被拒 / restore 后 schema 校验失败）→ `hubctl restore` 用正确包恢复 → doctor READY。回滚不依赖旧机存活。
