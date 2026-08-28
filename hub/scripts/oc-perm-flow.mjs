import fs from 'fs';

const BASE = 'http://127.0.0.1:4096';
const globalEvents = [];
const sessionEvents = [];

async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = text.slice(0, 200); }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 250)}`);
  return { status: res.status, data };
}

async function sse(path, sink, label) {
  const res = await fetch(BASE + path, { headers: { accept: 'text/event-stream' } });
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
            sink.push(ev);
            console.log(`[${label}] ${ev.type || '?'} ${JSON.stringify(ev).slice(0, 260)}`);
            if ((ev.type || '').includes('failed')) {
              console.log(`[${label}] FAILED_DETAIL: ${JSON.stringify(ev.data && (ev.data.error || ev.data)).slice(0, 600)}`);
            }
          } catch (e) { }
        }
      }
    }
  }
}

async function waitFor(pred, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = pred();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main() {
  const s = await j('POST', '/api/session', { location: { directory: '/home/huagosr/worker-sandbox/calc' } });
  const sid = s.data.data.id;
  console.log('session:', sid);

  const gTask = sse('/event', globalEvents, 'GLOBAL').catch((e) => console.log('global sse end:', e.message));
  const sTask = sse(`/api/session/${sid}/event`, sessionEvents, 'SESSION').catch((e) => console.log('session sse end:', e.message));

  await new Promise((r) => setTimeout(r, 1000));

  console.log('== sending bash prompt ==');
  await j('POST', `/api/session/${sid}/prompt`, { prompt: { text: '运行 npm test 并告诉我结果' } });

  await waitFor(() => {
    const pe = [...globalEvents, ...sessionEvents].find((e) => JSON.stringify(e).toLowerCase().includes('permission'));
    return pe || null;
  }, 150000, 'permission event in either stream');

  console.log('== messages after permission wait ==');
  const m = await j('GET', `/api/session/${sid}/message`);
  console.log(JSON.stringify(m.data).slice(0, 800));

  fs.writeFileSync('/tmp/oc-global-events.json', JSON.stringify(globalEvents, null, 2));
  fs.writeFileSync('/tmp/oc-session-events2.json', JSON.stringify(sessionEvents, null, 2));
  console.log('DONE');
  process.exit(0);
}

main().catch((e) => {
  console.log('FAILED:', e.message);
  fs.writeFileSync('/tmp/oc-global-events.json', JSON.stringify(globalEvents, null, 2));
  process.exit(1);
});
