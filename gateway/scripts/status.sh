#!/usr/bin/env bash
# status.sh — print health snapshot
set -u
GATEWAY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
H="$GATEWAY_DIR/data/state/health.json"

if [ -f "$H" ]; then
  GATEWAY_DIR="$GATEWAY_DIR" node -e '
    const h = require(process.env.GATEWAY_DIR + "/data/state/health.json");
    console.log("gateway:", h.gateway);
    console.log("agent_wechat:", h.agent_wechat);
    console.log("wechat_auth:", h.wechat_auth);
    console.log("last_poll_at:", h.last_poll_at);
    console.log("last_successful_poll_at:", h.last_successful_poll_at);
    console.log("last_message_at:", h.last_message_at);
    console.log("last_spool_write_at:", h.last_spool_write_at);
    console.log("poll_failures_consecutive:", h.poll_failures_consecutive);
    console.log("messages_collected_total:", h.messages_collected_total);
  '
else
  echo "no health.json at $H"
  exit 1
fi
