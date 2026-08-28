import fs from 'fs';
import { spawnSync } from 'child_process';

const BASE = 'http://127.0.0.1:4096';
const perms = [];
const events = [];

async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = text.slice(0, 300); }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 250)}`);
  return { status: res.status, data };
}

async function sse() {
  const res = await fetch(`${BASE}/global/event`, { headers: { accept: 'text/event-stream' } });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          const p = ev.payload || ev;
          const t = p.type || '?';
          events.push(t);
          if (t === 'permission.v2.asked') {
            perms.push(p.properties || p);
            console.log(`[PERM] ${p.properties.action} ${JSON.stringify(p.properties.resources).slice(0, 80)}`);
          }
        } catch (e) { }
      }
    }
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForPerm(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (perms.length > 0) return perms.shift();
    await sleep(500);
  }
  return null;
}

async function main() {
  sse().catch(() => {});

  const s = await j('POST', '/api/session', { location: { directory: '/home/huagosr/worker-sandbox/calc' }, model: { id: 'deepseek-chat', providerID: 'deepseek' } });
  const sid = s.data.data.id;
  console.log('session:', sid);
  await sleep(1200);

  console.log('== task: fix subtract bug ==');
  await j('POST', `/api/session/${sid}/prompt`, { prompt: { text: 'calc 项目有一个测试失败：subtract 函数实现有 bug。请修复 src/calc.js 使 npm test 全部通过。' } });

  let replied = 0;
  for (let i = 0; i < 12; i++) {
    const perm = await waitForPerm(45000);
    if (!perm) break;
    await j('POST', `/api/session/${sid}/permission/${perm.id}/reply`, { reply: 'once' });
    replied++;
    console.log(`replied #${replied}: ${perm.action}`);
  }
  console.log(`total permissions replied: ${replied}`);

  await sleep(8000);
  const m = await j('GET', `/api/session/${sid}/message`);
  const msgList = (m.data && m.data.data) || [];
  const texts = msgList.flatMap((x) => (x.content || []).filter((c) => c.type === 'text').map((c) => c.text)).join('\n');
  console.log('--- final agent text (tail) ---');
  console.log(texts.slice(-600));

  const r = spawnSync('bash', ['-lc', 'cd ~/worker-sandbox/calc && npm test 2>&1 | tail -n 4'], { encoding: 'utf8' });
  console.log('--- ground truth npm test ---');
  console.log(r.stdout);

  const d = await j('GET', `/session/${sid}/diff`);
  console.log('--- diff ---');
  console.log(JSON.stringify(d.data).slice(0, 400));

  console.log('DONE');
  process.exit(0);
}

main().catch((e) => { console.log('FAILED:', e.message); process.exit(1); });
