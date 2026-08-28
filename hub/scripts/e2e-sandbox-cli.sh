#!/usr/bin/env bash
H=/home/huagosr/wechat-linux-research/hub/data/workers/opencode/ex-18/home
WS=/home/huagosr/worker-sandbox-untrusted/calc
K=$(cut -d= -f2 ~/.opencode/.env)
echo "=== sandbox opencode.json ==="
cat $H/.opencode/opencode.json
echo "=== bwrap opencode run PONG (60s) ==="
timeout -k 5 60 bwrap --unshare-user --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup \
  --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /etc /etc \
  --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$H" "$H" --setenv HOME "$H" \
  --ro-bind "$HOME/.opencode/bin" /opt/opencode-bin \
  --ro-bind "$HOME/.opencode/node_modules" "$H/.opencode/node_modules" \
  --bind "$WS" "$WS" --chdir "$WS" \
  --clearenv --setenv PATH "/usr/bin:/bin:/usr/sbin:/sbin" --setenv LANG "C.UTF-8" \
  --setenv DEEPSEEK_API_KEY "$K" --setenv OPENCODE_DISABLE_AUTOUPDATE 1 \
  --die-with-parent -- /opt/opencode-bin/opencode run --print-logs "Reply with exactly: PONG" 2>&1 | tail -n 12
