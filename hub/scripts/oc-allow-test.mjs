import fs from 'fs';

const BASE = 'http://127.0.0.1:4096';

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

async function waitFor(pred, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await pred();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main() {
  const s = await j('POST', '/api/session', { location: { directory: '/home/huagosr/worker-sandbox/calc' } });
  const sid = s.data.data.id;
  console.log('session:', sid);
  await j('POST', `/api/session/${sid}/prompt`, { prompt: { text: '运行 npm test 并告诉我结果' } });
  console.log('prompt sent, waiting for completion...');
  await waitFor(async () => {
    const m = await j('GET', `/api/session/${sid}/message`);
    const s2 = JSON.stringify(m.data);
    return /pass|fail/.test(s2) && /test|测试/i.test(s2) ? m.data : null;
  }, 240000, 'test execution result');
  const m = await j('GET', `/api/session/${sid}/message`);
  console.log('MESSAGES:', JSON.stringify(m.data).slice(0, 2500));
  console.log('DONE');
  process.exit(0);
}

main().catch((e) => { console.log('FAILED:', e.message); process.exit(1); });
