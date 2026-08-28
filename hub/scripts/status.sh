#!/usr/bin/env bash
set -e
systemctl --user status personal-hub --no-pager
echo "---"
journalctl --user -u personal-hub -n 20 --no-pager
