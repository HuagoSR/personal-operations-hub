#!/usr/bin/env bash
set -e
export PATH="$HOME/.opencode/bin:$PATH"
WS=/home/huagosr/worker-sandbox-untrusted/calc
H=/home/huagosr/wechat-linux-research/hub/data/workers/opencode/ex-6/home
echo "=== profile home contents ==="
find "$H" -maxdepth 3 | head -20
echo "=== manual bwrap opencode serve (10s) ==="
timeout 10 bwrap --unshare-user --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup \
  --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /etc /etc \
  --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$H" "$H" --setenv HOME "$H" \
  --ro-bind "$HOME/.opencode/bin" /opt/opencode-bin \
  --ro-bind "$HOME/.opencode/node_modules" "$H/.opencode/node_modules" \
  --ro-bind "$HOME/.cache/opencode" "$H/.cache/opencode" \
  --bind /dev/null /usr/bin/sudo --bind /dev/null /usr/bin/su --bind /dev/null /usr/bin/pkexec \
  --bind "$WS" "$WS" --chdir "$WS" \
  --clearenv --setenv PATH "/usr/bin:/bin:/usr/sbin:/sbin" --setenv LANG "C.UTF-8" \
  --setenv "DEEPSEEK_API_KEY=$(cut -d= -f2 ~/.opencode/.env)" \
  --setenv OPENCODE_DISABLE_AUTOUPDATE=1 \
  --die-with-parent -- /opt/opencode-bin/opencode serve --port 4567 --hostname 127.0.0.1 2>&1 | head -n 20
