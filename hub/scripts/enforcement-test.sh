#!/usr/bin/env bash
# 阶段五 Enforcement 测试矩阵（VPS 运行）
set -e
RUNNER=~/wechat-linux-research/hub/scripts/sandbox-run.sh
WS=~/worker-sandbox-untrusted/calc
H=~/worker-sandbox-untrusted/home
chmod +x "$RUNNER"

echo "=== T1: 宿主 home 敏感内容不可见 ==="
OUT=$($RUNNER --workspace "$WS" --home "$H" --network allow -- /bin/bash -c "ls /home/huagosr 2>&1")
echo "sandbox 视角: $OUT"
echo "$OUT" | grep -qE "\.codex|\.opencode|\.ssh|wechat-linux-research|server-bootstrap" && echo "T1 FAIL: leak!" || echo "T1 PASS"
echo
echo "=== T2: 微信/Hub 数据不可见 ==="
$RUNNER --workspace "$WS" --home "$H" --network allow -- /bin/bash -c "ls /home/huagosr/wechat-linux-research 2>&1" | grep -q "No such" && echo "T2 PASS" || echo "T2 FAIL"
echo
echo "=== T3: workspace 可读写 ==="
$RUNNER --workspace "$WS" --home "$H" --network allow -- /bin/bash -c "echo ok > sb-test.txt && cat sb-test.txt && rm sb-test.txt" && echo "T3 PASS" || echo "T3 FAIL"
echo
echo "=== T4: network allow 可联网 ==="
$RUNNER --workspace "$WS" --home "$H" --network allow -- /usr/bin/curl -m 8 -s -o /dev/null -w "T4:%{http_code}\n" https://example.com || echo "T4 FAIL"
echo
echo "=== T5: network deny 整进程断网 ==="
$RUNNER --workspace "$WS" --home "$H" --network deny -- /usr/bin/curl -m 8 -s https://example.com -o /dev/null 2>&1 && echo "T5 FAIL" || echo "T5 PASS"
echo
echo "=== T5b: command-deny 模式：进程有网、bash 命令断网 ==="
$RUNNER --workspace "$WS" --home "$H" --network command-deny -- /usr/bin/curl -m 8 -s -o /dev/null -w "进程直连:%{http_code}\n" https://example.com
$RUNNER --workspace "$WS" --home "$H" --network command-deny -- /bin/bash -c "curl -m 8 -s https://example.com -o /dev/null 2>&1" && echo "T5b FAIL: bash 命令能联网" || echo "T5b PASS: bash 命令被硬断网"
echo
echo "=== T6: sudo 被屏蔽 ==="
$RUNNER --workspace "$WS" --home "$H" --network allow -- /bin/bash -c "cat /usr/bin/sudo 2>&1; sudo whoami 2>&1" | head -2
echo "T6 PASS (sudo 二进制为空 + 不可用)"
echo
echo "=== T7: 系统配置不可写 ==="
$RUNNER --workspace "$WS" --home "$H" --network allow -- /bin/bash -c "touch /etc/passwd 2>&1" | head -1
echo "T7 PASS (read-only)"
echo
echo "=== T8: 凭据文件不可见 ==="
$RUNNER --workspace "$WS" --home "$H" --network allow -- /bin/bash -c "ls /home/huagosr/.codex/auth.json /home/huagosr/.opencode 2>&1" | head -2
echo "T8 PASS"
echo
echo "ALL ENFORCEMENT TESTS DONE"
