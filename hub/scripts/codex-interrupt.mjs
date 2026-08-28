const WS_URL = 'ws://127.0.0.1:8765';
const CWD = '/home/huagosr/worker-sandbox-untrusted/calc';

function log(s) { console.log(s); }

const ws = new WebSocket(WS_URL);
let nextId = 1;
const pending = new Map();
let activeTurnId = null;

function send(method, params, isNotification = false) {
  const msg = isNotification ? { method, params } : { id: nextId++, method, params };
  ws.send(JSON.stringify(msg));
  return msg.id;
}

function rpc(method, params, timeoutMs = 120000) {
  const id = send(method, params);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); }
    }, timeoutMs);
  });
}

ws.onopen = async () => {
  log('ws connected');
  try {
    await rpc('initialize', {
      clientInfo: { name: 'hub-codex-validator', title: 'Hub Codex Validator', version: '0.5.0' },
      capabilities: { experimentalApi: true },
    });
    send('initialized', {}, true);

    const th = await rpc('thread/start', { cwd: CWD, title: 'hub-interrupt-test' });
    const threadId = th.result.thread.id;
    log(`threadId=${threadId}`);

    await rpc('turn/start', {
      threadId,
      input: [{ type: 'text', text: '从 1 数到 500，每个数字单独一行输出' }],
    });
    log('turn started, waiting 4s...');
    await new Promise((r) => setTimeout(r, 4000));

    log('== interrupt ==');
    const ir = await rpc('turn/interrupt', { threadId, turnId: activeTurnId || undefined });
    log(`interrupt result: ${JSON.stringify(ir.result || ir.error)}`);

    await new Promise((r) => setTimeout(r, 5000));

    log('== thread/read ==');
    const rd = await rpc('thread/read', { threadId, includeTurns: true });
    const t = rd.result.thread;
    log(`thread/read: turns=${(t.turns || []).length} lastStatus=${JSON.stringify((t.turns || []).map((x) => x.status))}`);

    log('== thread/list ==');
    const tl = await rpc('thread/list', { limit: 5 });
    log(`thread/list: ${(tl.result.threads || []).length} threads`);

    log('DONE');
    process.exit(0);
  } catch (e) {
    log('FAILED: ' + e.message);
    process.exit(1);
  }
};

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== undefined && msg.method) {
    ws.send(JSON.stringify({ id: msg.id, result: {} }));
    return;
  }
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg); }
    return;
  }
  const m = msg.method;
  if (m === 'turn/started') {
    activeTurnId = msg.params.turn.id;
    log(`turn/started turnId=${activeTurnId}`);
  } else if (m === 'turn/completed') {
    log(`turn/completed status=${msg.params.turn.status}`);
  } else if (m === 'thread/status/changed') {
    log(`status=${JSON.stringify(msg.params.status)}`);
  }
};

ws.onerror = () => log('ws error');
ws.onclose = () => log('ws closed');
