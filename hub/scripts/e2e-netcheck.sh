#!/usr/bin/env bash
H=/home/huagosr/worker-sandbox-untrusted/home2
K=$(cut -d= -f2 ~/.opencode/.env)
bwrap --unshare-user --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup \
  --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /etc /etc \
  --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$H" "$H" --setenv HOME "$H" \
  --clearenv --setenv PATH "/usr/bin:/bin:/usr/sbin:/sbin" --setenv LANG "C.UTF-8" \
  --setenv DEEPSEEK_API_KEY "$K" \
  --die-with-parent -- /usr/bin/curl -m 15 -sS -o /dev/null -w "deepseek-in-sandbox:%{http_code}\n" https://api.deepseek.com/v1/models -H "Authorization: Bearer $K"
echo "exit=$?"
