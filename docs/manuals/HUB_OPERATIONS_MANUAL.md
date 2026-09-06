# Hub 运维手册（HUB_OPERATIONS_MANUAL）

> 本手册是 **Harness Context Source #2**（继 WECHAT_GATEWAY_MANUAL 之后）：供人类运维与 Hub 的 LLM（经 Hub Self 项目）在处理 Hub 自身运维任务时共同引用。任何运维变更/新发现必须同步更新本手册。

## 1. 服务拓扑

| 服务 | systemd 单元 | 端口 | 职责 |
|---|---|---|---|
| personal-hub | systemd --user | 127.0.0.1:8300 | Hub Core + Control Web + Intelligence runner |
| wechat-gateway | systemd --user | —（读 127.0.0.1:6174） | 微信只读采集 → spool |
| wx-research-agent-wechat | Docker（compose） | 127.0.0.1:6174 | 微信客户端容器（第三方） |

数据位置（路径模型见 INSTALLATION.md）：DB=HUB_DATA_DIR/hub.db；Gateway spool=GATEWAY_DIR/data/spool；备份=HUB_BACKUP_DIR。

## 2. 日常命令

```bash
hubctl status                       # 服务 + Web 健康速览
hubctl doctor                       # 六域体检（READY/DEGRADED/ACTION_REQUIRED）
hubctl backup                       # 每日备份（建议 cron）
node scripts/intelligence-observe.js   # Intelligence 观察期每日快照
curl -s 127.0.0.1:8300/api/intelligence/status   # shadow 运行状态/预算/置信度分布
journalctl --user -u personal-hub -f          # Hub 日志（正文不入日志）
journalctl --user -u wechat-gateway -f        # Gateway 日志
```

## 3. 例行检查清单（每日/每周）

- [ ] `hubctl doctor` = READY；有 DEGRADED 项则按 TROUBLESHOOTING 处理
- [ ] Inbox 有新消息且（若启用）智能分析在 10 分钟窗口后出现
- [ ] 预算：`/api/intelligence/status` 的 day/month 远低于 $0.5/$5
- [ ] 磁盘头room > 5 GiB（`df -h`）
- [ ] 备份存在且 < 24h（`ls $HUB_BACKUP_DIR`）
- [ ] 微信：gateway health.json `wechat_auth=logged_in`、`poll_failures_consecutive=0`

## 4. Hub Self 更新（apply/rollback）

```bash
bash <checkout>/hub/scripts/prepare-update.sh        # 只读预览 dev 副本待应用内容
bash <checkout>/hub/scripts/apply-hub.sh <reqId>     # 停服→tar 备份→rsync→起服→health check→标记 APPLIED
bash <checkout>/hub/scripts/rollback-hub.sh latest   # 带外回滚（不依赖 Hub 存活）
```

- apply 前自动备份（tar + sha256 + manifest 记录）；health check 三项（/api/status、/、/api/bootstrap/status）全过才 APPLIED
- 失败：按打印的 rollback 指令执行，勿盲目重试
- 微信/Gateway 与 Hub apply 相互独立

## 5. 数据与恢复

- 备份/恢复：见 BACKUP_RESTORE.md；迁移到新机：见 MIGRATION.md
- 版本升级：见 UPGRADE.md（先备份后迁移，只进不退）
- Hub DB 不可变表（results/transition_log/domain_events/intelligence_analyses）：修复只加标记/新行，不 UPDATE

## 6. 故障速查

| 现象 | 手册 |
|---|---|
| Hub 起不来 / 503 / CHDIR | TROUBLESHOOTING.md §1 |
| 微信收不到消息 / 登录循环 | WECHAT_GATEWAY_MANUAL §3.8 + WECHAT_LOGIN_GUIDE |
| 智能分析缺失 / 预算封锁 | TROUBLESHOOTING.md §4 |
| Codex 执行失败 / WAITING | TROUBLESHOOTING.md §3 |
| 磁盘满 / DB locked | TROUBLESHOOTING.md §5 |

## 7. 维护规则

- 任何运维变更/事故/新发现 → 更新对应手册（本手册或 TROUBLESHOOTING）并记日期
- 本手册与代码同仓（docs/manuals/）；与 WECHAT_GATEWAY_MANUAL / WECHAT_LOGIN_GUIDE 互为姊妹篇
