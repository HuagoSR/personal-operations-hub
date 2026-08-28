#!/usr/bin/env bash
echo "=== bwrap basic (unshare-all) ==="
bwrap --unshare-all --proc /proc --dev /dev true && echo "bwrap OK" || echo "bwrap FAILED (exit $?)"
echo "=== bwrap with rw tmpfs + ro-bind /usr ==="
bwrap --unshare-all --proc /proc --dev /dev --tmpfs /tmp --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 /bin/echo "sandboxed echo OK" || echo "FAILED"
echo "=== network deny test ==="
bwrap --unshare-all --proc /proc --dev /dev --tmpfs /tmp --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 /usr/bin/curl -m 5 -s https://example.com -o /dev/null -w "curl-in-sandbox:%{http_code}" 2>&1 || echo "curl FAILED (expected if net denied)"
echo
echo "=== userns sysctls ==="
sysctl kernel.unprivileged_userns_clone 2>/dev/null
sysctl kernel.apparmor_restrict_unprivileged_userns 2>/dev/null
cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null
