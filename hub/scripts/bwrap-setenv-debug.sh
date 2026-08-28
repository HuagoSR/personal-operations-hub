#!/usr/bin/env bash
K=$(cut -d= -f2 ~/.opencode/.env)
echo "key len: ${#K}"
echo "--- test1: setenv with key ---"
bwrap --unshare-user --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --proc /proc --dev /dev --setenv "DEEPSEEK_API_KEY=$K" /bin/echo "setenv-ok" && echo PASS1 || echo FAIL1
echo "--- test2: clearenv + setenv ---"
bwrap --unshare-user --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --proc /proc --dev /dev --clearenv --setenv PATH /usr/bin:/bin --setenv "DEEPSEEK_API_KEY=$K" /bin/echo "clearenv-ok" && echo PASS2 || echo FAIL2
