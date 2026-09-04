# 微信登录操作手册（WeChat Gateway 容器）

> 适用：`wx-research-agent-wechat` 容器内的官方 Linux 微信客户端（agent-wechat）。
> 编写：2026-09-04，基于多次成功与失败的实战记录。
> VPS：huago-cone（用户 huagosr），工作目录 `~/wechat-linux-research/`。

## 0. 核心结论（先读）

1. **手机端请关闭"该设备自动登录"**。实测该选项不可靠：微信被服务器下线后客户端反复"重启→自动重登→再被踢"，形成每 1-2 分钟一轮的对抗循环，持续数天无法自愈，还会干扰正常登录。
2. 掉线/登不上的正确恢复路径 = **人工登录一次**（本文档第 3 节）。
3. 登录后 Gateway 会自动恢复采集（`WAITING_FOR_LOGIN → RUNNING`），无需重启任何服务。

## 1. 判断当前是否需要登录

```bash
# VPS 上执行
TOK=$(tr -d '\n' < ~/wechat-linux-research/deploy/token)
curl -s "http://127.0.0.1:6174/api/status/auth?token=$TOK"
```

期望：`{"loggedInUser":"wxid_94y2q***_4db2","status":"logged_in"}`

- `logged_in` → 已登录，无需操作
- `logged_out` / `app_not_running` → 需要走第 3 节登录流程
- 注意：`GET /api/status` 的 `loginState.status` 是**硬编码假值**（恒为 logged_out），一律以 `/api/status/auth` 为准

## 2. 先看界面再动手

```bash
# 2a. 截图（保存到 ~/wechat-linux-research/deploy/screen.png，scp 到本地查看）
curl -s -m 60 "http://127.0.0.1:6174/api/debug/screenshot?token=$TOK" \
  | python3 -c "import sys,json,base64; open('/home/huagosr/wechat-linux-research/deploy/screen.png','wb').write(base64.b64decode(json.load(sys.stdin)['base64']))"

# 本地（Windows PowerShell）拉取查看
scp huago-cone:wechat-linux-research/deploy/screen.png F:\CloudCone\Wechat\screen.png

# 2b. 看 a11y 树（找按钮与坐标）
curl -s -m 60 "http://127.0.0.1:6174/api/debug/a11y?token=$TOK"
```

界面特征对照：

| 界面 | a11y/视觉特征 | 处理 |
|---|---|---|
| 二维码页 | 屏幕中央二维码 | 提取二维码 → 手机扫码（第 3.1 节） |
| 手机确认页 | "请在手机上确认"类文字 | 手机微信确认（第 3.2 节） |
| 账号选择页 | MiniSR 头像 + "Enter Weixin" 绿色按钮 | xdotool 点 Enter（第 3.3 节） |
| 登录中/加载 | 无固定按钮 | 等待 30-60s 再截图 |
| 空白内容区 | 窗口在但内容空、FSM 报 Unknown state | 大概率是上述之一未加载，重启微信进程（第 4 节） |

## 3. 登录流程

### 3.1 场景 A：需要扫码（二维码页 / 全新登录）

```bash
# VPS：启动登录流（后台），它会把最新二维码存到 deploy/qr.png
cd ~/wechat-linux-research/deploy
rm -f qr.png login.log
nohup node scripts/login-ws.cjs > login.log 2>&1 &

# 等待 15-30s，出现 QR_UPDATED 后下载二维码到本地
scp huago-cone:wechat-linux-research/deploy/qr.png F:\CloudCone\Wechat\qr.png
```

手机微信「扫一扫」扫码 → 手机上点「确认登录」。
二维码约 2 分钟刷新；过期后脚本会自动更新 `qr.png`（重新 scp 即可）。

### 3.2 场景 B：手机确认（界面提示"请在手机上确认"或等待确认）

无需二维码。直接：
1. 打开手机微信（小号，应用分身）
2. 微信通常推送「登录确认」→ 点确认
3. 若未收到推送：微信 → 我 → 设置 → 账号与安全 → 登录设备管理，查看/允许设备
4. 确认后容器内客户端自动进入聊天界面

### 3.3 场景 C：停在账号选择页（点 "Enter Weixin"）

界面出现 MiniSR 头像 + "Enter Weixin" 按钮（说明本地登录数据还在，点按钮即可，**不需要重新扫码**）：

```bash
# 1. 从 a11y 树找按钮坐标（name="Enter Weixin" 的 bounds 中心）
#    实测坐标：Enter Weixin ≈ (640, 487)（Xvfb 1280x800）
# 2. 用 xdotool 点击（容器内已安装 xdotool）
docker exec wx-research-agent-wechat bash -c \
  'DISPLAY=:99 su -s /bin/bash wechat -c "xdotool mousemove 640 487 click 1"'

# 3. 若点击后出现二维码/确认页 → 回到 3.1 / 3.2
```

注意：点击后 auth 会短暂变 `logged_out`（进入登录流程），正常现象。

### 3.4 通用兜底：让 agent-wechat 的登录 FSM 处理

```bash
cd ~/wechat-linux-research/deploy && rm -f qr.png login.log
nohup node scripts/login-ws.cjs > login.log 2>&1 &
# 观察 docker logs（agent-server 的 [exec] 日志）与 login.log
```

局限：FSM 只认识固定几种登录界面；账号选择页（Enter Weixin）会报 `Unknown state` 卡住——此时必须用 3.3 手动点。

## 4. 界面空白 / FSM 卡死 / 登录循环的处置

症状：截图内容区空白；agent-server 日志 `Unknown state (Ns), waiting...`；或微信进程每 1-2 分钟消失又出现（health monitor 重启 + 自动登录对抗循环）。

处置顺序：
1. **若手机开了"自动登录" → 先去手机端关闭**（设置 → 账号与安全 → 登录设备管理 / 自动登录开关），否则循环无法自愈
2. 截图确认当前界面（第 2 节）
3. 按界面走 3.1/3.2/3.3
4. 若仍空白：手动重启微信进程（health monitor 3 秒内自动拉起）：

```bash
# 找到微信主进程并杀掉（health monitor 会自动重启）
docker exec wx-research-agent-wechat bash -c 'pkill -x wechat; sleep 5; pgrep -x wechat || echo "restarted by health monitor"'
sleep 60   # 等微信完成启动
# 再截图确认界面
```

5. 登录成功标准（第 5 节确认）

## 5. 登录成功确认

```bash
# 预期三项全绿
curl -s "http://127.0.0.1:6174/api/status/auth?token=$TOK"    # logged_in
cat ~/wechat-linux-research/gateway/data/state/health.json      # wechat_auth: logged_in, poll_failures_consecutive: 0
systemctl --user is-active wechat-gateway                       # active
```

登录后 Gateway 日志会出现 `WAITING_FOR_LOGIN -> RUNNING`；掉线期间的消息会自动补采（无需额外操作）。

## 6. 安全须知

- 本流程只对**自己的微信小号**操作；全程不调用任何发送/open/logout API（logout 会让客户端退出但服务器会话未清，反而制造"手机显示已登录/实际已掉线"的混乱，**不要使用**）。
- 二维码图片用完即删（`qr.png` / `screen.png`），勿提交到任何仓库。
- 若登录失败且出现风控提示（如"操作过于频繁"），停止尝试，间隔 10-30 分钟再试。
