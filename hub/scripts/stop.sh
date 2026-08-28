#!/usr/bin/env bash
set -e
systemctl --user stop personal-hub
systemctl --user status personal-hub --no-pager
