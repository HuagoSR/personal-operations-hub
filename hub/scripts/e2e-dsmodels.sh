#!/usr/bin/env bash
K=$(cut -d= -f2 ~/.opencode/.env)
for M in deepseek-v4-flash deepseek-v4-pro deepseek-chat; do
  CODE=$(curl -s -m 30 -X POST https://api.deepseek.com/v1/chat/completions \
    -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
    -d "{\"model\":\"$M\",\"messages\":[{\"role\":\"user\",\"content\":\"PONG\"}],\"max_tokens\":5}" -o /tmp/ds-resp.json -w "%{http_code}")
  echo "$M -> HTTP $CODE: $(head -c 200 /tmp/ds-resp.json)"
done
