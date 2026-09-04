# 微信 Gateway 操作手册（WECHAT_GATEWAY_MANUAL）

> 本手册是 **Harness Context Source**（受管理的机器可消费操作知识库），供人类运维与 Hub 的 LLM（经 Hub Self 项目）在处理 Gateway 任务时共同引用。
> 维护规则：Gateway 任何代码变更、版本变更、故障模式新发现、恢复流程变化，**必须同步更新本手册的版本元数据与相关章节**。违反此规则 = 手册失效。

## 版本元数据（每次变更/验证后更新）

| 字段 | 值 |
|---|---|
| manual_version | v1.1 |
| last_verified_at | 2026-09-04（登录恢复流程按 `WECHAT_LOGIN_GUIDE.md` 实战验证；消息采集恢复） |
| gateway_version | V0.1 |
| agent_wechat_commit | f72e7552（ghcr.io/thisnick/agent-wechat:latest，digest sha256:31a4e351…4b24） |
| wechat_version | 官方 Linux 4.1.1.4（容器内 /opt/wechat/wechat，BuildID eba86b80） |
| applies_to | 微信只读采集链路：容器 → agent-wechat(127.0.0.1:6174) → collector → spool |
| 验证边界 | 微信升级/agent-wechat 升级/容器镜像更换后本手册**可能失效**，须重新走 smoke+soak 后更新此表 |

---

## 1. 架构

```
微信客户端（容器，SYS_PTRACE+seccomp unconfined）
  ↓ 本地 DB（SQLCipher immutable 只读）
agent-wechat server（127.0.0.1:6174，Bearer token）
  ↓ 仅 4 个 GET 方法（agent-client.js）
gateway collector（Node ≥22，systemd --user wechat-gateway）
  ↓ 原子 cursor + 双层 dedup
spool 按日 JSONL + fsync（data/spool/YYYY-MM-DD.jsonl，勿删）
```

- 消息读取 = SQLCipher 只读打开 message_N.db；DB key 登录时从 /proc/pid/mem 提取（需 SYS_PTRACE + seccomp=unconfined，风险已记录）
- **发送/打开会话/登出全部依赖 UI 自动化，collector 完全不实现**（只有 GET）
- 状态机（state.js）：`STARTING → RUNNING → DEGRADED → WAITING_FOR_LOGIN → RUNNING`，另有 `ERROR / STOPPING`
- 目录：`gateway/src/`（collector/agent-client/cursor/spool/dedup/health/metrics/state/logger/config）、`data/{spool,state,metrics}/`、`logs/gateway.log`（5MB×5 轮转）、`config/config.json`（覆盖 example）
- spool 记录字段（schema_version=1）：source/gateway_id/chat_type/chat_id/chat_name/sender_id/sender_name/message_id/local_id/message_type/text/is_mentioned/reply/wechat_timestamp/collected_at/sequence
- 排序规则：sequence（单调）> local_id > collected_at > wechat_timestamp（sender 时钟不可靠，仅展示）

## 2. 状态机与健康判定

| 状态 | 含义 | 常见触发 |
|---|---|---|
| STARTING | 启动中 | systemd 拉起 |
| RUNNING | 正常采集 | 正常 |
| DEGRADED | 轮询失败/agent 不可达 | 容器停、agent-server 挂、网络错误（backoff 1-30s） |
| WAITING_FOR_LOGIN | 登录态丢失，等待登录流 | 容器重启、微信掉线且自动登录未生效 |
| ERROR | 致命错误 | 见日志 |
| STOPPING | 优雅停止 | systemctl stop |

- 健康快照：`gateway/data/state/health.json`（10s 原子写）；指标 `gateway/data/metrics/YYYY-MM-DD.json`
- 诊断命令：`bash gateway/scripts/status.sh`、`bash gateway/scripts/report.sh`

## 3. 故障模式与恢复 SOP

> 所有故障场景实测数据零丢失/零损坏/零重复（2026-08-31 故障注入 F1–F5）。
> **登录确认硬限制：一般掉线重登需要手机端操作；F2/F3 的自动恢复是「该设备自动登录」勾选的特例，不保证适用于新设备/新版本。**

### 3.1 collector 停机（systemctl stop / crash）
- 现象：无新消息落 spool；`systemctl --user status wechat-gateway` 非 running
- 恢复：`systemctl --user start wechat-gateway`；重启后 5 秒内自动补采停机窗口消息
- 验证：cursor/sequence 连续、无重复（双层 dedup 校验）

### 3.2 微信容器停止/agent-wechat 不可达
- 现象：Gateway `RUNNING → DEGRADED`（backoff：1,2,4,8,15,30s，8 次失败后稳定）
- 恢复：`docker start <wechat-container>` → 容器内微信 `logged_out` → `DEGRADED → WAITING_FOR_LOGIN` → 登录流（自动登录凭证或手机确认）→ `RUNNING`
- 注意：`docker restart` 容器 = 登录态丢失（除非自动登录勾选）

### 3.3 设备被服务器下线（手机端"登录设备管理"退出）
- 现象：客户端被下线 → health monitor 自动重启微信 → 自动登录重登 → 循环（约 2 分钟/次，每次约 10 秒 app_not_running）
- 处理：**保持现状**（自动恢复模式），接受分钟级波动；掉线期间消息由服务器缓存，重登后补采
- 如需彻底下线：手机端再次退出即可（循环会自行停止）

### 3.4 agent-server 进程崩溃（容器内）
- 现象：`RUNNING → DEGRADED`；entrypoint 自动重启 agent-server
- 影响：**微信保持 logged_in**（容器未重启）
- 恢复：自动；无需人工

### 3.5 collector 被 kill -9
- 现象：进程消失；systemd `RestartSec=10` 自动拉起（新实例 STARTING→RUNNING）
- 数据：cursor/dedup 原子写经受硬杀考验（实测 145 条 0 损坏 0 重复）

### 3.6 微信登录失败 / WAITING_FOR_LOGIN 持续
- 诊断：`bash gateway/scripts/status.sh`；日志找 login 相关行；`/api/status/auth`（agent 侧）
- 处理：确认微信容器正常 → 多数情况需**手机端确认登录**（微信客户端弹窗/手机微信确认）→ 若自动登录凭证有效可自动恢复
- **禁止**：任何尝试绕过登录/提取 QR 之外凭据的操作

### 3.7 spool 积压 / 磁盘
- 现象：spool 目录异常大；磁盘告警
- 处理：勿删 spool（已入库可归档）；`gateway/data/spool/` 历史文件可压缩归档到 `research-archive` 惯例位置

### 3.8 登录失败 / 卡在登录界面 / 反复重启（2026-09-04 实战新增）

- 完整操作流程见 **`WECHAT_LOGIN_GUIDE.md`**（同目录），本节只记关键机制与红线：
- 机制：agent 健康监控每 1s 做 a11y→identify，**60s 识别不到 mainWindow 就强杀微信进程**（5 次快速重启后退避 30s）。登录/账号选择/扫码界面没有 mainWindow 节点 → 必然被杀 → 表现为「点不动/窗口消失/循环重启」。
- 缓解：agent 登录 FSM 执行期间监控暂停（`POST /api/status/login` 或 `deploy/scripts/login-ws.cjs`），此窗口期窗口稳定可交互/可扫码。
- 正确恢复路径 = **人工登录一次**（扫码或手机确认），登录后 Gateway 自动 `WAITING_FOR_LOGIN → RUNNING` 并补采掉线期消息。
- **手机端关闭「该设备自动登录」**：实测该选项在设备被踢时会造成「重启→自动重登→再被踢」的对抗循环，数天无法自愈。
- 状态判断以 `GET /api/status/auth` 为准；**`GET /api/status` 的 loginState.status 是硬编码假值（恒 logged_out），不要采信**。
- 界面交互三条路：① 截图+OCR/肉眼（`/api/debug/screenshot?token=` 或容器内 scrot）② 容器内 xdotool 注入点击（`docker exec … DISPLAY=:99 xdotool`，账号选择页按钮实测坐标 ≈ (640,487)/(674,464)）③ noVNC 远程桌面 `http://127.0.0.1:6174/vnc/?token=<TOKEN>&autoconnect=true`（经 SSH 隧道 6174）。
- 红线不变：全程不调用发送/open/logout 接口（logout 会造成「手机显示已登录/实际掉线」混乱）；二维码图片用完即删、不入库。

## 4. 安全红线（System Invariant，不可被任何配置覆盖）

- **WECHAT_WRITE = FORBIDDEN**：禁止任何发送/open/logout 能力，任何 Project/Grant/用户覆盖都不能开启
- 五层强制：① agent-client 只有 4 个 GET（无通用请求助手）② Worker workspace 不含 Gateway 写路径 ③ 操作白名单（Gateway Ops Facade）④ `scripts/check-readonly.sh` 静态门（任何修改的 apply 前置门）⑤ 手册即文档门
- 凭据：token/DB key 永不进日志；日志 chat/sender id = sha256[:8]；正文只进 spool 不进日志
- Docker socket **永不暴露给任何 Worker**（等价宿主控制权）；容器操作只能经白名单 Facade + 用户 ASK

## 5. 运维命令

```bash
systemctl --user start|stop|restart wechat-gateway
systemctl --user status wechat-gateway
journalctl --user -u wechat-gateway -f          # 日志（正文不入日志）
bash gateway/scripts/status.sh                   # 健康快照
bash gateway/scripts/report.sh                   # 今日指标汇总
bash gateway/scripts/check-readonly.sh           # 只读静态检查（修改后必跑）
docker ps                                        # 微信容器状态（只读查看）
bash hub/scripts/apply-hub.sh ...                # Hub 自举 apply（不影响 Gateway）
```

## 6. 已知坑（历史教训，勿重蹈）

1. **unread-aware baseline**：新会话 baseline 若直接播种 cursor 会漏消息（私聊 stress 漏 4/10）；unread>0 时先采最近 unread 条。**该行为已固化，禁止回退**
2. WAL checkpoint 由微信自身决定 → 新消息可见延迟约 2.5–10s（中位 4.5–7.2s），poll 间隔不是瓶颈
3. `wechat_timestamp` 是发送端时钟，不可靠（实测 -2.2~+10.2s 偏差），仅展示
4. 容器重启 = 登录态丢失；自动登录勾选才能免手机确认
5. `/api/ws/events` 是空壳（无 push），只能轮询
6. 微信升级可能改变 key extraction / UI / 自动登录行为 → 本手册验证边界失效，须重验并更新版本表
7. agent-wechat 无 LICENSE，上游 2026-05 后无实质更新；判定 FORK_AND_SIMPLIFY 但未执行
8. **健康监控 60s 门槛**：登录/账号选择/扫码界面无 mainWindow 节点 → 60s 必杀；FSM 执行期暂停监控，人工登录务必走 LOGIN_GUIDE 流程
9. **「该设备自动登录」不可靠**：设备被踢后形成对抗循环（每 1-2 分钟一轮），建议保持关闭，恢复用人工登录
10. `GET /api/status` 的 loginState 是硬编码假值；只信 `/api/status/auth`

## 7. 手册维护规则

- Gateway 任何变更/验证/故障发现 → 更新版本元数据表 + 相关章节 + `last_verified_at`
- 新章节准入：必须基于实测（smoke/soak/故障注入），不写猜测
- 本手册与代码同仓（GitHub personal-operations-hub docs/manuals/）；VPS `~/wechat-linux-research/docs/manuals/` 随同步分发
- **姊妹手册**：`WECHAT_LOGIN_GUIDE.md`（登录操作流程，场景 A/B/C + 兜底 + 安全须知）；本手册 §3.8 与其互链，二者更新需同步
