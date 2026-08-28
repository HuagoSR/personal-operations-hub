const WS_URL = 'ws://127.0.0.1:8765';
const CWD = '/home/huagosr/worker-sandbox-untrusted/calc';

function log(s) { console.log(s); }

const ws = new WebSocket(WS_URL);
let nextId = 1;
const pending = new Map();
const serverRequests = [];

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
      clientInfo: { name: 'hub-codex-validator', title: 'Hub Codex Validator', version: '0.4.0' },
      capabilities: { experimentalApi: true },
    });
    send('initialized', {}, true);
    log('initialize ok');

    const th = await rpc('thread/start', { cwd: CWD, title: 'hub-net-approval' });
    const threadId = th.result.thread.id;
    log(`threadId=${threadId}`);

    let turnErr = null;
    try {
      await rpc('turn/start', {
        threadId,
        input: [{ type: 'text', text: '运行 curl https://example.com 并把 HTTP 状态码告诉我' }],
        approvalPolicy: 'on-request',
        sandboxPolicy: { type: 'workspaceWrite', writableRoots: [CWD], networkAccess: false },
      });
    } catch (e) { turnErr = e; }
    log(turnErr ? `turn/start error: ${turnErr.message}` : 'turn/start ok');

    setTimeout(() => {
      log('=== summary ===');
      log('server requests: ' + serverRequests.map((r) => `${r.method} kind=${r.params.kind || ''}`).join(' | ') || 'NONE');
      for (const r of serverRequests) {
        log(JSON.stringify(r.params).slice(0, 500));
      }
      log('DONE');
      process.exit(0);
    }, 150000);
  } catch (e) {
    log('FAILED: ' + e.message);
    process.exit(1);
  }
};

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== undefined && msg.method) {
    const m = msg.method;
    log(`<< SERVER-REQUEST ${m}`);
    serverRequests.push(msg);
    if (m === 'item/commandExecution/requestApproval') {
      log('>> decision=accept');
      ws.send(JSON.stringify({ id: msg.id, result: { decision: 'accept' } }));
    } else if (m === 'item/fileChange/requestApproval') {
      log('>> fileChange decision=accept');
      ws.send(JSON.stringify({ id: msg.id, result: { decision: 'accept' } }));
    } else {
      ws.send(JSON.stringify({ id: msg.id, result: {} }));
    }
    return;
  }
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg); }
    return;
  }
  const m = msg.method;
  if (m === 'turn/completed') {
    const t = msg.params.turn;
    log(`<< turn/completed status=${t.status}`);
    const final = (t.items || []).filter((i) => i.type === 'agentMessage' && i.phase === 'final_answer');
    if (final.length) log('FINAL: ' + final[0].text.slice(0, 250));
  } else if (m === 'thread/status/changed') {
    log(`<< status=${JSON.stringify(msg.params.status)}`);
  }
};

ws.onerror = () => log('ws error');
ws.onclose = () => log('ws closed');
