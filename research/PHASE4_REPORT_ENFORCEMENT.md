# ExecutionGrant Enforcement 设计与实测报告（PHASE4_REPORT_ENFORCEMENT）

- 日期：2026-08-28
- 环境：VPS huago-cone（Ubuntu 22.04，`kernel.unprivileged_userns_clone=1`，**无需 sudo**）
- 实现：`hub/scripts/sandbox-run.sh`（bwrap 封装）；测试 `hub/scripts/enforcement-test.sh`
- 结论：**PASS（8/8）**——OS 级强制边界已实测生效，Enforcement Gate（D009）通过。

## 1. 设计：Grant → Policy Translator → bwrap

```
ExecutionGrant（ALLOW/ASK/DENY）
        ↓ Policy Translator（hub/src/workers/exec）
bwrap 外层沙箱（workspace 隔离 + 凭据隔离 + 提权屏蔽）
        ↓
worker 进程（opencode serve / codex app-server；模型 API 网络保留）
        ↓ 每个 bash 子命令
命令级嵌套 bwrap（--unshare-net）＝ network DENY 的硬边界
```

### 挂载模型（外层）

| 路径 | 方式 | 目的 |
|---|---|---|
| /usr /bin /lib /lib64 /etc | ro-bind | 运行所需系统库/工具（/etc 只读→系统配置不可改） |
| /proc /dev /tmp | proc/dev/tmpfs | 运行隔离 |
| 授权 workspace | bind rw | 唯一可写项目目录 |
| 私有 HOME（per-execution 持久目录） | bind rw | 会话/日志落盘且重启可恢复；**与宿主 home 完全分离** |
| /home/huagosr 其余内容 | 不挂载（仅由 workspace 自动链可见） | 宿主 .ssh/.codex/.opencode/微信/Hub 数据不可见 |
| /usr/bin/sudo /su /pkexec | 空文件遮蔽 | 无提权路径（实测 sudo 报错不可用） |
| network=deny | 整进程 --unshare-net | 全离线（含模型调用） |
| network=command-deny | /bin/bash 替换为包装器 | 进程有网（模型 API），bash 命令进嵌套断网沙箱 |

### 凭据模型

- 宿主凭据（~/.codex/auth.json、~/.opencode/.env、SSH key）**永不挂载**。
- 注入：`--env`（如 DEEPSEEK_API_KEY）；Codex ChatGPT 凭据采用"profile 目录复制一份 + ro-bind"（仅任务需要的凭据文件）。
- Hub 自身的 secret 在 Worker 沙箱内不可见（T8 实测）。

## 2. 测试矩阵（8/8 PASS，2026-08-28 实测）

| # | 边界 | 结果 |
|---|---|---|
| T1 | 宿主 home 敏感内容不可见（.codex/.opencode/.ssh/微信/Hub） | PASS |
| T2 | 微信/Hub 数据目录不可访问 | PASS |
| T3 | 授权 workspace 可读写 | PASS |
| T4 | network allow 可联网（HTTP 200） | PASS |
| T5 | network deny 整进程硬断网（curl 000） | PASS |
| T5b | command-deny：进程直连 200（模型可用）而 **bash 命令硬断网** | PASS |
| T6 | sudo/su 被屏蔽（空文件+报错不可用） | PASS |
| T7 | /etc/passwd 只读（系统配置不可改） | PASS |
| T8 | 宿主凭据文件不可见 | PASS |

## 3. 与 Worker 策略层的分工（D009：policy + enforcement 两层）

| Grant 维度 | OS 强制（本报告） | Worker policy（审批链） |
|---|---|---|
| workspace | bwrap 只挂授权目录 | opencode external_directory=ask；codex writableRoots |
| network ALLOW | 不限制 | opencode bash 内命令可联网；codex networkAccess=true |
| network ASK | 不限制（待审批） | opencode permission.asked / codex requestApproval → Hub 转发用户 |
| network DENY | **bash 命令级硬断网（T5b）** | 双保险：opencode/codex 侧同步 deny |
| sudo/system_config | **二进制屏蔽+只读（T6/T7）** | 双保险：Grant 映射 deny |
| 凭据 | **不挂载宿主凭据（T8）** | 仅注入任务所需 |

## 4. 遗留与限制（如实记录）

1. bwrap 挂载的 workspace 自动父目录链会在沙箱内可见（T1 输出含 `worker-sandbox-untrusted` 目录名）——**无内容泄露**，但路径名可见；可接受，记录在案。
2. command-deny 包装器替换 /bin/bash：只约束经 bash 的命令；若 worker 直接 exec 其他解释器（sh/python）绕过，需在 Worker policy 层兜底（opencode/codex 的命令都走 bash，实测确认）。
3. 嵌套 userns 正常（Ubuntu 22.04 无 apparmor 限制实测通过）；若未来系统加固（apparmor_restrict_unprivileged_userns=1）需重新验证。
4. 内存/CPU 未做 cgroup 限额（bwrap 无此能力）——非本阶段 Gate 项（列 Phase 5 观察项）。
