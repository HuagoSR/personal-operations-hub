#!/usr/bin/env bash
sed -i 's|executions/9|executions/10|' /tmp/e2e-status.sh
bash /tmp/e2e-status.sh
journalctl --user -u personal-hub --since "16:32:30" --no-pager | grep -E "pump error|oc-worker" | tail -n 6
