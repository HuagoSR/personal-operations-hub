#!/usr/bin/env bash
curl -s -X POST http://127.0.0.1:4096/api/session \
  -H "Content-Type: application/json" \
  -d '{"location":{"directory":"/home/huagosr/worker-sandbox/calc"}}' | head -c 800
echo
