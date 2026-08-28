#!/usr/bin/env bash
set -e
systemctl --user start personal-hub
systemctl --user status personal-hub --no-pager
