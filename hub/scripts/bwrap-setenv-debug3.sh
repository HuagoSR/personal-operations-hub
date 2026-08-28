#!/usr/bin/env bash
echo "--- two-arg form ---"
bwrap --unshare-user --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --proc /proc --dev /dev --setenv FOO bar /bin/echo ok && echo PASS || echo FAIL
echo "--- env prefix approach ---"
bwrap --unshare-user --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --proc /proc --dev /dev /usr/bin/env FOO=bar /bin/echo "env-ok $FOO" && echo PASS || echo FAIL
