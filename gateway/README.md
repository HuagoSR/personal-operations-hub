# Gateway V0.1 — Read-only WeChat message collector

Long-running read-only gateway: polls the local agent-wechat server (127.0.0.1:6174) with **GET requests only** and durably spools collected messages.

## Layout

```
src/             gateway code (zero npm dependencies, Node >= 22)
  collector.js   main loop: poll / auth monitor / health / metrics / graceful shutdown
  agent-client.js READ-ONLY client (getAuthStatus / listChats / listMessages / getMedia)
  cursor.js      atomic cursor (tmp + fsync + rename)
  spool.js       daily JSONL spool, fsync per message
  dedup.js       second-layer dedup (recent 10000 keys)
  health.js      health model (10s atomic write)
  metrics.js     daily metrics + 60s resource samples
  state.js       state machine (STARTING/RUNNING/DEGRADED/WAITING_FOR_LOGIN/ERROR/STOPPING)
  logger.js      leveled logging + privacy hashing + rotation
data/
  spool/         YYYY-MM-DD.jsonl (durable, do not delete)
  state/         cursor.json / dedup.json / health.json / gateway.pid
  metrics/       YYYY-MM-DD.json
logs/            gateway.log (rotated, 5MB x 5)
config/          config.example.json (copy to config.json to override)
scripts/         start.sh / stop.sh / status.sh / report.sh / check-readonly.sh
```

## Safety boundaries

- The client only implements 4 GET methods; there is no generic request helper.
- `scripts/check-readonly.sh` statically verifies no POST/send/open/logout references.
- Secrets (token, DB keys) are never logged; chat/sender ids are logged as sha256[:8].
- Message bodies go only into the spool, never into logs.

## Operations

```bash
systemctl --user start wechat-gateway     # start
systemctl --user stop wechat-gateway      # graceful stop (flush + persist)
scripts/status.sh                          # health snapshot
scripts/report.sh                          # today's metrics summary
```

## Message record format

See spool files under `data/spool/`. Fields: schema_version, source, gateway_id,
chat_type, chat_id, chat_name, sender_id, sender_name, message_id, local_id,
message_type, text, is_mentioned, reply, wechat_timestamp, collected_at, sequence.

Ordering rule: sequence (monotonic) > local_id > collected_at > wechat_timestamp
(sender clock is unreliable and is kept for display only).
