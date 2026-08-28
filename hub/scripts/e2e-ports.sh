#!/usr/bin/env bash
P=$(pgrep -f "opencode serve" | grep -v $(pgrep -f 'opencode serve --port 4096') | head -1)
echo "=== serve proc ==="
ps -o pid,ppid,etime,cmd -p $(pgrep -af 'opencode serve' | grep -v 4096 | awk '{print $1}' | head -1) 2>/dev/null | head -3
echo "=== test /doc on all worker ports ==="
for port in $(ss -tlnp 2>/dev/null | grep -oE '127\.0\.0\.1:[0-9]+' | grep -vE ':8300|:4096|:8765' | cut -d: -f2 | sort -u); do
  code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$port/doc")
  echo "port $port /doc=$code"
done
