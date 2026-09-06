# 安装手册（INSTALLATION）

- 适用：Personal Operations Hub v0.1.0 全新安装
- 支持矩阵：Ubuntu 22.04 / 24.04 LTS（x86-64，单用户，systemd）；Node.js ≥ 22.13；bubblewrap
- 外部前置：**Codex CLI 已安装并完成 `codex login`**（Hub 不代办安装/登录）
- 可选集成：Docker + agent-wechat（微信）；DeepSeek API（Intelligence）

## 1. 快速开始（推荐）

```bash
# 1. 系统依赖
sudo apt-get update && sudo apt-get install -y bubblewrap rsync tar curl
# Node >= 22.13：使用 nvm / NodeSource 安装，验证 node --version

# 2. 获取代码（GitHub Release 制品或仓库）
mkdir -p ~/pohub && cd ~/pohub
tar -xzf personal-operations-hub-v0.1.0.tar.gz
cd hub

# 3. 交互式初始化
node bin/hubctl.js onboard
#   → 系统检查 → Codex 校验 → 可选微信/DeepSeek → 安装目录规划 → 安装 systemd 服务并启动

# 4. 校验
node bin/hubctl.js doctor     # 期望 READY

# 5. 访问 Control Web（本机 SSH 隧道）
ssh -L 8300:127.0.0.1:8300 <server>
# 浏览器打开 http://127.0.0.1:8300
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
