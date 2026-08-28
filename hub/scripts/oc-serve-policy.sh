#!/usr/bin/env bash
set -e
export PATH="$HOME/.opencode/bin:$PATH"
export OPENCODE_DISABLE_AUTOUPDATE=1
export DEEPSEEK_API_KEY=$(cut -d= -f2 ~/.opencode/.env)
cat > ~/.opencode/opencode.json <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "deepseek/deepseek-chat",
  "small_model": "deepseek/deepseek-chat",
  "permission": {
    "edit": "ask",
    "bash": "ask",
    "webfetch": "ask"
  },
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "deepseek" }
    ]
  },
  "provider": {
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DeepSeek",
      "options": {
        "baseURL": "https://api.deepseek.com/v1",
        "apiKey": "{env:DEEPSEEK_API_KEY}"
      },
      "models": {
        "deepseek-chat": { "name": "DeepSeek Chat" }
      }
    }
  }
}
EOF
pkill -f "opencode serve" 2>/dev/null || true
sleep 2
nohup opencode serve --port 4096 --hostname 127.0.0.1 > /tmp/oc-serve.log 2>&1 < /dev/null &
disown
for i in $(seq 1 25); do
  sleep 1
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4096/doc | grep -q 200; then
    echo "serve up"
    exit 0
  fi
done
echo "serve failed"; exit 1
