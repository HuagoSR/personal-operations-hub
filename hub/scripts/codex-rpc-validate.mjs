import { spawn } from 'child_process';

const SOCK = '/home/huagosr/.codex/app-server-control/app-server-control.sock';
const LOG = [];

function log(s) { console.log(s); }

const child = spawn('codex', ['app-server', 'proxy', '--sock', SOCK], { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '';
child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { log(`NON-JSON: ${line.slice(0, 200)}`); continue; }
    onMessage(msg);
  }
});
child.stderr.on('data', (d) => log(`[stderr] ${d.toString().slice(0, 300)}`));
child.on('exit', (c) => log(`proxy exited code=${c}`));

let nextId = 1;
function send(method, params, isNotification = false) {
  const msg = isNotification ? { method, params } : { id: nextId++, method, params };
  log(`>> ${method} ${JSON.stringify(params || {}).slice(0, 200)}`);
  child.stdin.write(JSON.stringify(msg) + '\n');
  return msg.id;
}

const pending = new Map();
const requests = [];

function onMessage(msg) {
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    const p = pending.get(msg.id);
    if (p) { p.resolve(msg); pending.delete(msg.id); }
    log(`<< RESULT id=${msg.id} ${JSON.stringify(msg.result !== undefined ? msg.result : msg.error).slice(0, 250)}`);
    return;
  }
  if (msg.id !== undefined && msg.method) {
    log(`<< SERVER-REQUEST id=${msg.id} method=${msg.method} ${JSON.stringify(msg.params).slice(0, 300)}`);
    requests.push(msg);
    return;
  }
  const kind = msg.method ? `NOTIFY ${msg.method}` : '???';
  log(`<< ${kind} ${JSON.stringify(msg.params || {}).slice(0, 200)}`);
  if (msg.method === 'thread/started') {
    log(`<< THREAD: ${JSON.stringify(msg.params).slice(0, 400)}`);
  }
  if (msg.method === 'turn/completed') {
    log(`<< TURN COMPLETED: ${JSON.stringify(msg.params).slice(0, 600)}`);
    setTimeout(() => process.exit(0), 500);
  }
}

function rpc(method, params) {
  const id = send(method, params);
  return new Promise((resolve) => pending.set(id, { resolve }));
}

async function main() {
  await new Promise((r) => setTimeout(r, 1500));
  log('== initialize ==');
  const init = await rpc('initialize', {
    clientInfo: { name: 'hub-codex-validator', version: '0.1.0' },
    capabilities: ['turns', 'threads', 'approvals'],
  });
  log('initialize result keys: ' + Object.keys(init.result || {}).join(','));
  send('initialized', {}, true);

  log('== thread/start ==');
  const th = await rpc('thread/start', { cwd: '/home/huagosr/worker-sandbox/calc', title: 'hub-validation' });
  const threadId = th.result && (th.result.threadId || th.result.thread_id || th.result.id);
  log(`thread/start result: ${JSON.stringify(th.result).slice(0, 400)}`);
  log(`threadId = ${threadId}`);

  log('== turn/start ==');
  await rpc('turn/start', {
    threadId,
    input: [{ type: 'text', text: '运行 npm test 并告诉我结果' }],
  });
  log('turn started');

  setTimeout(() => {
    log('TIMEOUT 300s, exiting');
    process.exit(2);
  }, 300000).unref();
}

main().catch((e) => { log('FAILED: ' + e.message); process.exit(1); });
