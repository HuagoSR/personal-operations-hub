const WS_URL = 'ws://127.0.0.1:8765';
const CWD = '/home/huagosr/worker-sandbox-untrusted/calc';

function log(s) { console.log(s); }

const ws = new WebSocket(WS_URL);
let nextId = 1;
const pending = new Map();
const serverRequests = [];
const commandOutputs = [];

function send(method, params, isNotification = false) {
  const msg = isNotification ? { method, params } : { id: nextId++, method, params };
  ws.send(JSON.stringify(msg));
  return msg.id;
}

function rpc(method, params, timeoutMs = 90000) {
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
      clientInfo: { name: 'hub-codex-validator', title: 'Hub Codex Validator', version: '0.3.0' },
      capabilities: { experimentalApi: true },
    });
    send('initialized', {}, true);
    log('initialize ok');

    const th = await rpc('thread/start', { cwd: CWD, title: 'hub-approval-untrusted' });
    const threadId = th.result.thread.id;
    log(`threadId=${threadId}`);

    const turn = await rpc('turn/start', {
      threadId,
      input: [{ type: 'text', text: '修复 src/calc.js 的 subtract bug 并运行 npm test 验证' }],
      approvalPolicy: 'on-request',
    });
    log('turn/start ok');

    setTimeout(() => {
      log('=== summary ===');
      log('server requests: ' + serverRequests.map((r) => `${r.method}(${r.params.reason || ''})`).join(' | '));
      log('command output tail: ' + commandOutputs.join('').slice(-200));
      log('DONE');
      process.exit(0);
    }, 180000);
  } catch (e) {
    log('FAILED: ' + e.message);
    process.exit(1);
  }
};

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== undefined && msg.method) {
    const m = msg.method;
    log(`<< SERVER-REQUEST ${m} reason=${JSON.stringify(msg.params.reason || '').slice(0, 80)}`);
    serverRequests.push(msg);
    if (m === 'item/commandExecution/requestApproval' || m === 'item/fileChange/requestApproval') {
      log('>> decision=accept');
      ws.send(JSON.stringify({ id: msg.id, result: { decision: 'accept' } }));
    } else if (m === 'item/tool/requestUserInput') {
      log('>> userInput answer=继续');
      ws.send(JSON.stringify({ id: msg.id, result: { answer: '继续' } }));
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
  } else if (m === 'item/commandExecution/outputDelta') {
    commandOutputs.push(msg.params.delta || '');
  }
};

ws.onerror = () => log('ws error');
ws.onclose = () => log('ws closed');
