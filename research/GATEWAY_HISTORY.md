# 微信 Gateway 历史（GATEWAY_HISTORY）

> 本文浓缩自 2026-08-24 的 9 份调研/实验/验证报告（environment / project-comparison / agent-wechat-internals / read-only-design / phase5 / phase6 / FINAL_REPORT / gateway-security-check / gateway-v01-baseline·smoke·24h）。原报告已归档于 VPS `~/research-archive-20260828.tar.gz`。

## 1. 环境与组件（2026-08 冻结）

- VPS：Ubuntu 22.04.5 x86_64 / 10 vCPU（Xeon E5-2620，单核弱）/ 7.7G RAM / Docker 29.7 + Compose v5.3 / Node v22.23.2
- 微信：官方 Linux 4.1.1.4（腾讯 CDN deb，容器内 `/opt/wechat/wechat`，BuildID `eba86b80`）
- agent-wechat：`ghcr.io/thisnick/agent-wechat:latest`，digest `sha256:31a4e351…4b24`，源码 commit `f72e7552`（2026-05-17 后无实质更新，**无 LICENSE**）
- 端口：agent-server 仅 127.0.0.1:6174，Bearer token 认证；远程访问 SSH Tunnel

## 2. 技术路线结论（调研期）

- 4 个候选项目对比后选定 agent-wechat：唯一"DB 直读（不依赖 UI）+ 普通微信群支持"的方案；判定 **FORK_AND_SIMPLIFY**（读取栈可靠，但发送能力与读取同进程，需裁剪）
- 关键机制：消息读取 = SQLCipher 只读打开（`immutable=1`）message_N.db；DB key 由登录 FSM 从 `/proc/pid/mem` 扫描提取（需 SYS_PTRACE + seccomp=unconfined）；发送/打开会话/登出全部依赖 UI 自动化（xdotool/Frida），读取完全不依赖
- 只读化设计（read-only-design）：编译期裁剪 send/open/logout/Type/Key/paste/Frida，LOGIN 与 RUNTIME 能力分离；**本阶段未 fork**，过渡方案 = 网关只发 GET + 端口 127.0.0.1 + 静态检查
- 已知硬限制：上游 #82 移除了 WAL checkpoint 任务 → 新消息可见性由微信自身 checkpoint 决定（实测延迟 2.5~10s，中位数 4.5-7.2s，poll 间隔非瓶颈）；`/api/ws/events` 是空壳（无 push，只能轮询）；容器重启=登录态丢失需人工重登；`wechat_timestamp` 是发送端时钟不可靠

## 3. 实测结论（phase5/phase6，2026-08-24）

| 能力 | 结果 |
|---|---|
| 文本/中文/emoji、sender 解析、群判定、@（is_mentioned）、引用（reply）、图片（.dat 解密）、文件 | 全部实测通过 |
| 语音 | 未验证 |
| 消息延迟 | -2.2~10.2s（负延迟=发送端时钟偏差）；WAL checkpoint 主导 |
| 掉线重登 | 容器重启即掉线；手机确认可重登（WS 不发 QR，须以 `/api/status/auth` 轮询为准）；重登后自动补采 |
| 资源 | 微信容器 CPU 86-92% 瞬时 / 内存 487-832MiB |

**Phase6 最重要的踩坑**：新会话 baseline 若直接播种 cursor 会漏消息（私聊 stress 漏 4/10）→ 修复为 unread-aware baseline（unread>0 时先采最近 unread 条）。该行为已固化在 Gateway V0.1，禁止回退。

## 4. Gateway V0.1（现役，勿动）

- 结构：`gateway/src/`（agent-client 只 4 个 GET 方法 / cursor 原子写 / dedup 两层 / spool 按日 JSONL+fsync / health / metrics / 状态机 STARTING→RUNNING→DEGRADED→WAITING_FOR_LOGIN→STOPPING）
- 部署：systemd --user `wechat-gateway`（linger）；PID 单实例锁；backoff [1,2,4,8,15,30]s
- spool 记录字段（schema_version=1）：source/gateway_id/chat_type/chat_id/chat_name/sender_id/sender_name/message_id/local_id/message_type/text/is_mentioned/reply/wechat_timestamp/collected_at/sequence（按 gateway 单调）
- 验证历史：smoke 全过（重启 0 重复、容器停 2min→DEGRADED→恢复、掉线→WAITING_FOR_LOGIN→RUNNING 自动恢复、双实例拒绝）；24h Gate PASS（0 crash/0 损坏/0 POST/0 重复）；7 天 soak 进行中（day 报告在 `research/soak/`）
- 安全边界：6174 仅 127.0.0.1；`check-readonly.sh` 静态检查 CLEAN；日志 chat/sender hash 前 8 位、正文不入日志；风险记录：Docker 卷含微信 DB key（agent-wechat 固有设计，未修复）
