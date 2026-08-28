#!/usr/bin/env bash
echo "--- no auth header ---"
curl -s -m 30 -X POST https://api.deepseek.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"PONG"}],"max_tokens":5}' -w "\nHTTP %{http_code}\n" | head -c 300
echo "--- empty Bearer ---"
curl -s -m 30 -X POST https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer " -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"PONG"}],"max_tokens":5}' -w "\nHTTP %{http_code}\n" | head -c 300
