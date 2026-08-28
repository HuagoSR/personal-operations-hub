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

async function sse(path, label) {
  const res = await fetch(BASE + path, { headers: { accept: 'text/event-stream' } });
  console.log(`[${label}] connected, status=${res.status}, ct=${res.headers.get('content-type')}`);
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
        if (line.startsWith('data: ')) {
          try {
            const ev = JSON.parse(line.slice(6));
            console.log(`[${label}] ${ev.type || '?'} ${JSON.stringify(ev).slice(0, 200)}`);
          } catch (e) { }
        }
      }
    }
  }
}

async function main() {
  sse('/global/event', 'GLOBAL-EVENT').catch((e) => console.log('global-event end:', e.message));

  const s = await j('POST', '/api/session', { location: { directory: '/home/huagosr/worker-sandbox/calc' }, model: { id: 'deepseek-chat', providerID: 'deepseek' } });
  const sid = s.data.data.id;
  console.log('session:', sid);

  await new Promise((r) => setTimeout(r, 1500));

  await j('POST', `/api/session/${sid}/prompt`, { prompt: { text: '运行 npm test 并告诉我结果' } });
  console.log('prompt sent');

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const v1 = await j('GET', '/permission');
    if (v1.data && v1.data.length) { console.log('V1 LIST HIT:', JSON.stringify(v1.data).slice(0, 400)); break; }
    const v2 = await j('GET', '/api/permission/request');
    if (v2.data && v2.data.data && v2.data.data.length) { console.log('V2 LIST HIT:', JSON.stringify(v2.data.data).slice(0, 400)); break; }
  }
  console.log('DONE');
  process.exit(0);
}

main().catch((e) => { console.log('FAILED:', e.message); process.exit(1); });
