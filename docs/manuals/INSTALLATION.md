# 安装手册（INSTALLATION）

- 适用：Personal Operations Hub v0.1.0 全新安装
- 支持矩阵：Ubuntu 22.04 / 24.04 LTS（x86-64，单用户，systemd）；Node.js ≥ 22.13；bubblewrap
- 外部前置：**Codex CLI 已安装并完成 `codex login`**（Hub 不代办安装/登录）
- 可选集成：Docker + agent-wechat（微信）；DeepSeek API（Intelligence）

## 1. 快速开始（推荐）

```bash
# 0. 前置自检（不满足 → Node 用 nvm/NodeSource 安装；Codex 见下文）
node --version          # >= 22.13
codex --version
codex login status

# 1. 系统依赖
sudo apt-get update && sudo apt-get install -y bubblewrap rsync tar curl

# 2. 获取 Release 制品
mkdir -p ~/pohub && cd ~/pohub
curl -LO https://github.com/HuagoSR/personal-operations-hub/releases/download/v0.1.0/personal-operations-hub-v0.1.0.tar.gz
curl -LO https://github.com/HuagoSR/personal-operations-hub/releases/download/v0.1.0/SHA256SUMS
sha256sum -c SHA256SUMS

# 3. 解压并初始化（制品为平铺布局：~/pohub/hub 即 Hub Core；交互式：系统检查 → Codex 校验 → 可选微信/DeepSeek → 目录规划 → 服务安装并启动）
tar -xzf personal-operations-hub-v0.1.0.tar.gz
cd ~/pohub/hub
node bin/hubctl.js onboard
# onboard 结束时会创建 ~/.local/bin/hubctl 软链（确保 ~/.local/bin 在 PATH 中）

# 4. 校验（此后统一使用 hubctl 命令）
hubctl doctor     # 期望 READY

# 5. 访问 Control Web —— 注意命令执行位置：
#    服务器上：  hubctl status
#    本地电脑：  ssh -L 8300:127.0.0.1:8300 user@your-server
#    本地浏览器打开：http://127.0.0.1:8300
```

## 2. 手动安装（不启用 onboard）

```bash
cd ~/pohub/hub
cp config/config.example.json config/config.json   # 按需修改
node bin/hubctl.js service install
node bin/hubctl.js start
```

路径模型（全部可 env 覆盖，默认 XDG）：

| 变量 | 默认 |
|---|---|
| HUB_CONFIG_DIR | ~/.config/personal-operations-hub |
| HUB_DATA_DIR | ~/.local/share/personal-operations-hub |
| HUB_STATE_DIR | ~/.local/state/personal-operations-hub |
| HUB_WORKSPACE_ROOT | ~/pohub-workspace |

## 3. 可选集成

### 3.1 微信（agent-wechat，第三方外部依赖）

```bash
# deploy/docker-compose.yml 使用经验证的固定镜像（见 THIRD_PARTY.md），勿改回 :latest
cd ~/pohub/deploy
cp -n token.example token 2>/dev/null || openssl rand -hex 32 > token   # 若尚未生成
docker compose up -d
# 登录：见 docs/manuals/WECHAT_LOGIN_GUIDE.md（手机端保持关闭"该设备自动登录"）
```

### 3.2 DeepSeek Intelligence（可选）

```bash
# onboard 已引导，或手动：
mkdir -p ~/.config/personal-operations-hub/secrets
printf 'HUB_INTELLIGENCE_API_KEY=sk-...\n' > ~/.config/personal-operations-hub/secrets/intelligence.env
chmod 600 ~/.config/personal-operations-hub/secrets/intelligence.env
# 然后在 config.json 中设置 "intelligenceEnabled": true
```

## 4. 安装后检查清单

- [ ] `hubctl doctor` = READY
- [ ] Control Web 可访问（SSH 隧道）
- [ ] `hubctl backup` 成功（此后定期备份）
- [ ] Codex 任务 smoke：在 Web 中创建一个任务候选并批准（fake-worker 即可）
- [ ] （若启用）微信登录 + 消息入 Inbox；Intelligence shadow 分析出现
