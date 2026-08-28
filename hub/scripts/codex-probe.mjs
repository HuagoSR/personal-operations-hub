import { spawn } from 'child_process';

const SOCK = '/home/huagosr/.codex/app-server-control/app-server-control.sock';
const child = spawn('codex', ['app-server', 'proxy', '--sock', SOCK], { stdio: ['pipe', 'pipe', 'pipe'] });

function log(s) { console.log(s); }
let buf = '';
child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) log(`<< ${line.slice(0, 300)}`);
  }
});
child.stderr.on('data', (d) => log(`[stderr] ${d.toString().slice(0, 300)}`));
child.on('exit', (c) => { log(`proxy exit ${c}`); process.exit(0); });

function send(msg) {
  log(`>> ${JSON.stringify(msg).slice(0, 250)}`);
  child.stdin.write(JSON.stringify(msg) + '\n');
}

setTimeout(() => {
  log('-- variant 1: bare initialize --');
  send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'probe', version: '0' }, capabilities: [] } });
}, 1000);

setTimeout(() => {
  log('-- variant 2: jsonrpc 2.0 initialize --');
  send({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { clientInfo: { name: 'probe', version: '0' }, capabilities: [] } });
}, 4000);

setTimeout(() => {
  log('-- variant 3: bare thread/list --');
  send({ id: 3, method: 'thread/list', params: {} });
}, 7000);

setTimeout(() => { log('DONE (no responses)'); process.exit(0); }, 12000);
