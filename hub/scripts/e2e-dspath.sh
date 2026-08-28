#!/usr/bin/env bash
K=$(cut -d= -f2 ~/.opencode/.env)
echo "--- without /v1 ---"
curl -s -m 30 -X POST https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"PONG"}],"max_tokens":5}' -w "\nHTTP %{http_code}\n" | head -c 400
echo "--- with /v1, no Bearer prefix ---"
curl -s -m 30 -X POST https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: $K" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"PONG"}],"max_tokens":5}' -w "\nHTTP %{http_code}\n" | head -c 300
