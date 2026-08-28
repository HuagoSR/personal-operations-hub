const WS_URL = 'ws://127.0.0.1:8765';

function log(s) { console.log(s); }

const ws = new WebSocket(WS_URL);
let nextId = 1;
const pending = new Map();
const serverRequests = [];
const events = [];

function send(method, params, isNotification = false) {
  const msg = isNotification ? { method, params } : { id: nextId++, method, params };
  ws.send(JSON.stringify(msg));
  return msg.id;
}

function rpc(method, params, timeoutMs = 30000) {
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
      clientInfo: { name: 'hub-codex-validator', title: 'Hub Codex Validator', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    log(`initialize ok: ${Object.keys(init.result || {}).join(',')}`);
    send('initialized', {}, true);

    const th = await rpc('thread/start', { cwd: '/home/huagosr/worker-sandbox/calc', title: 'hub-validation-ws' });
    const threadId = th.result.thread.id;
    log(`threadId=${threadId}`);

    const turn = await rpc('turn/start', {
      threadId,
      input: [{ type: 'text', text: '杩愯 npm test 骞跺憡璇夋垜缁撴灉锛堜腑鏂囷級' }],
    });
    log(`turn/start ok: turnId=${turn.result.turnId}`);

    setTimeout(() => {
      log('=== summary ===');
      log('events seen: ' + [...new Set(events)].join(', '));
      log('server requests: ' + serverRequests.map((r) => r.method).join(', '));
      log('DONE');
      process.exit(0);
    }, 240000);
  } catch (e) {
    log('FAILED: ' + e.message);
    process.exit(1);
  }
};

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== undefined && msg.method) {
    log(`<< SERVER-REQUEST id=${msg.id} method=${msg.method} params=${JSON.stringify(msg.params).slice(0, 350)}`);
    serverRequests.push(msg);
    if (msg.method === 'item/commandExecution/requestApproval') {
      const decision = 'accept';
      log(`>> responding decision=${decision}`);
      send('approval/respond', null);
      ws.send(JSON.stringify({ id: msg.id, result: { decision } }));
    } else if (msg.method === 'item/fileChange/requestApproval') {
      ws.send(JSON.stringify({ id: msg.id, result: { decision: 'accept' } }));
      log('>> fileChange accepted');
    } else if (msg.method === 'item/tool/requestUserInput') {
      ws.send(JSON.stringify({ id: msg.id, result: { answer: '缁х画' } }));
      log('>> userInput answered');
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
  events.push(m);
  if (['turn/started', 'turn/completed', 'thread/status/changed', 'thread/started'].includes(m)) {
    log(`<< ${m} ${JSON.stringify(msg.params).slice(0, 400)}`);
  } else if (m && m.startsWith('item/') && !m.includes('delta')) {
    log(`<< ${m} ${JSON.stringify(msg.params).slice(0, 250)}`);
  }
};

ws.onerror = (e) => log('ws error');
ws.onclose = () => log('ws closed');

