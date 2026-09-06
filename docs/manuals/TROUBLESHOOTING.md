# 故障排查手册（TROUBLESHOOTING）

通用第一步：`hubctl doctor` 看六域输出；`journalctl --user -u <unit> -n 100 --no-pager` 看日志。

## 1. Hub 服务问题

| 症状 | 排查 |
|---|---|
| `personal-hub` inactive / activating 循环 | `journalctl --user -u personal-hub -n 50`；常见：`CHDIR`（WorkingDirectory 指向不存在的 checkout）、config.json 非法 JSON（`node bin/hubctl.js doctor` 会报） |
| 端口占用 | `ss -tlnp \| grep 8300`；改 config `port` 或杀掉占位进程 |
| Web 页面 404 | 检查 checkout 的 `src/web/` 完整（vendor/ 是否在）；重新部署 |
| 启动后 schema 报错 | 数据库比代码旧/新？`hubctl doctor` 的 schema_version 对比；降级需先 restore 匹配版本（UPGRADE.md） |

## 2. 数据库问题

| 症状 | 排查 |
|---|---|
| `database is locked` | 多进程打开？停止第二个进程；WAL 模式已默认；`PRAGMA busy_timeout` 5s 已设置 |
| integrity_check 失败 | 停服 → 用最近备份 restore（BACKUP_RESTORE.md）→ doctor |
| 迁移卡住 | 查看 schema_migrations 版本 vs migrations/ 目录；**迁移只进不退**，出错先备份再排查 |

## 3. Codex Worker

| 症状 | 排查 |
|---|---|
| `codex: not found` | 安装 Codex CLI 或 config `codexBinary` 指向实际路径；`hubctl doctor` 校验 |
| login status 未认证 | `codex login`（用户自管理；Hub 不代办） |
| app-server 启动失败 | `hubctl doctor --deep` 的 15s 启动探测；检查 CODEX_HOME 与网络（app-server 需出网调用模型） |
| 任务一直 WAITING_FOR_APPROVAL | Approvals 页处理权限请求；或 Grant 被吊销 → 重新批准 |
| 执行 FAILED | Results 页看 error 字段；常见：workspace 在 allowedRoots 之外（config `workerAllowedRoots`） |

## 4. Intelligence（live shadow）

| 症状 | 排查 |
|---|---|
| Inbox 无分析 | ① `intelligenceEnabled`=true？② 消息是否在 Inbox（只分析 @/私聊）③ 10 分钟窗口未到（episode 未关闭）④ `/api/intelligence/status` 看 pending/failed |
| 预算封锁（blocked） | 状态端点 `budget.blocked`；提高上限需改 config（用户决策），或等日/月窗口重置 |
| 分析全 FAILED schema invalid | 模型输出偏离 v1 schema → 检查 prompt 版本；重跑 eval（`node eval/intelligence/runners/eval-run.js --provider deepseek`） |
| 凭据缺失 | `HUB_CONFIG_DIR/secrets/intelligence.env` 存在且 600；或 env `HUB_INTELLIGENCE_API_KEY` |
| 数据出站疑虑 | 政策 D023（仅 Inbox + 匿名 + 敏感 chat 禁）；config `intelligenceDenyEgressChats` 加敏感 chat |

## 5. 资源问题

| 症状 | 排查 |
|---|---|
| 磁盘满 | `df -h`；清理：旧备份 tar（保留最近 N 份）、spool 归档、日志轮转（已 5MB×5） |
| 内存高 | 微信容器是大头（约 0.5–0.9 GiB）；Hub 本体很小；必要时 `docker stats` 确认 |
| 时区/时间漂移 | 全部用 UTC 存储；展示层用浏览器时区；不要手改 DB 时间戳 |

## 6. 微信/Gateway

→ 见 `WECHAT_GATEWAY_MANUAL.md`（状态机/故障 SOP/60s 监控机制）与 `WECHAT_LOGIN_GUIDE.md`（登录流程）。

## 7. 修复后必做

- `hubctl doctor` 回到 READY 或已知可接受的 DEGRADED
- 本次故障与解法记入本手册对应小节（维护规则）
