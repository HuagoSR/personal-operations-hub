#!/usr/bin/env bash
# status.sh — print health snapshot
set -u
GATEWAY_DIR="$HOME/wechat-linux-research/gateway"
H="$GATEWAY_DIR/data/state/health.json"

if [ -f "$H" ]; then
  node -e '
    const h = require(process.env.HOME + "/wechat-linux-research/gateway/data/state/health.json");
    console.log("gateway:", h.gateway);
    console.log("agent_wechat:", h.agent_wechat);
    console.log("wechat_auth:", h.wechat_auth);
    console.log("last_poll_at:", h.last_poll_at);
    console.log("last_successful_poll_at:", h.last_successful_poll_at);
    console.log("last_message_at:", h.last_message_at);
    console.log("poll_failures_consecutive:", h.poll_failures_consecutive);
    console.log("messages_collected_total:", h.messages_collected_total);
    console.log("duplicate_messages_total:", h.duplicate_messages_total);
    console.log("uptime_seconds:", h.uptime_seconds);
  '
else
  echo "no health file yet"
fi

pid_file="$GATEWAY_DIR/data/state/gateway.pid"
if [ -f "$pid_file" ]; then
  pid=$(cat "$pid_file")
  if kill -0 "$pid" 2>/dev/null; then
    echo "collector process: running (pid $pid)"
  else
    echo "collector process: NOT RUNNING (stale pid $pid)"
  fi
else
  echo "collector process: NOT RUNNING"
fi
