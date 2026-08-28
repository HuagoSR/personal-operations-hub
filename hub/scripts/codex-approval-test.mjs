const WS_URL = 'ws://127.0.0.1:8765';

function log(s) { console.log(s); }

const ws = new WebSocket(WS_URL);
let nextId = 1;
const pending = new Map();
const serverRequests = [];
let turnCompletedAt = null;
let interrupted = false;

function send(method, params, isNotification = false) {
  const msg = isNotification ? { method, params } : { id: nextId++, method, params };
  ws.send(JSON.stringify(msg));
  return msg.id;
}

function rpc(method, params, timeoutMs = 60000) {
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
    const init = await rpc('initialize', {
      clientInfo: { name: 'hub-codex-validator', title: 'Hub Codex Validator', version: '0.2.0' },
      capabilities: { experimentalApi: true },
    });
    log('initialize ok');
    send('initialized', {}, true);

    const th = await rpc('thread/start', { cwd: '/home/huagosr/worker-sandbox/calc', title: 'hub-approval-test' });
    const threadId = th.result.thread.id;
    log(`threadId=${threadId}`);

    log('== turn/start with approvalPolicy on-request ==');
    let turn;
    try {
      turn = await rpc('turn/start', {
        threadId,
        input: [{ type: 'text', text: '淇 src/calc.js 鐨?subtract 鍑芥暟 bug 骞惰繍琛?npm test 楠岃瘉' }],
        approvalPolicy: 'unlessTrusted',
      });
      log(`turn/start ok turnId=${turn.result.turnId}`);
    } catch (e) {
      log('turn/start with approvalPolicy failed: ' + e.message);
      log('retrying without approvalPolicy...');
      turn = await rpc('turn/start', {
        threadId,
        input: [{ type: 'text', text: '淇 src/calc.js 鐨?subtract 鍑芥暟 bug 骞惰繍琛?npm test 楠岃瘉' }],
      });
      log(`turn/start ok turnId=${turn.result.turnId}`);
    }

    setTimeout(async () => {
      log('=== 40s: resume test ===');
      try {
        const r = await rpc('thread/resume', { threadId });
        log('thread/resume ok');
      } catch (e) { log('resume failed: ' + e.message); }
      setTimeout(() => {
        log('=== summary ===');
        log('server requests: ' + serverRequests.map((r) => r.method).join(', '));
        log('DONE');
        process.exit(0);
      }, 30000);
    }, 40000);
  } catch (e) {
    log('FAILED: ' + e.message);
    process.exit(1);
  }
};

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== undefined && msg.method) {
    log(`<< SERVER-REQUEST id=${msg.id} method=${msg.method} params=${JSON.stringify(msg.params).slice(0, 400)}`);
    serverRequests.push(msg);
    if (msg.method === 'item/commandExecution/requestApproval') {
      log('>> decision=accept');
      ws.send(JSON.stringify({ id: msg.id, result: { decision: 'accept' } }));
    } else if (msg.method === 'item/fileChange/requestApproval') {
      log('>> fileChange decision=accept');
      ws.send(JSON.stringify({ id: msg.id, result: { decision: 'accept' } }));
    } else if (msg.method === 'item/tool/requestUserInput') {
      log('>> userInput answer=缁х画');
      ws.send(JSON.stringify({ id: msg.id, result: { answer: '缁х画' } }));
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
  if (['turn/started', 'turn/completed', 'thread/status/changed'].includes(m)) {
    log(`<< ${m} ${JSON.stringify(msg.params).slice(0, 350)}`);
    if (m === 'turn/completed' && msg.params.turn) {
      const items = msg.params.turn.items || [];
      const final = items.filter((i) => i.type === 'agentMessage' && i.phase === 'final_answer');
      if (final.length) log('FINAL ANSWER: ' + final[0].text.slice(0, 300));
    }
  } else if (m && (m === 'item/started' || m === 'item/completed')) {
    const it = msg.params.item;
    if (it && (it.type === 'commandExecution' || it.type === 'fileChange' || it.type === 'agentMessage')) {
      log(`<< ${m} ${it.type} ${JSON.stringify(it).slice(0, 200)}`);
    }
  }
};

ws.onerror = () => log('ws error');
ws.onclose = () => log('ws closed');

