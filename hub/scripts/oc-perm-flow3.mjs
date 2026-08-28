import fs from 'fs';

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

async function sse(path, label) {
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
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          const p = ev.payload || ev;
          const t = p.type || ev.type || '?';
          events.push(t);
          if (t === 'permission.v2.asked') {
            perms.push(p.properties || p);
            console.log('PERMISSION ASKED:', JSON.stringify(p).slice(0, 400));
          } else if (t && (t.includes('tool.') || t.includes('step.') || t.includes('text.'))) {
            console.log(`  [${label}] ${t}`);
          }
        } catch (e) { }
      }
    }
  }
}

async function waitFor(pred, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = pred();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main() {
  sse('/global/event', 'GE').catch((e) => console.log('sse end:', e.message));

  const s = await j('POST', '/api/session', { location: { directory: '/home/huagosr/worker-sandbox/calc' }, model: { id: 'deepseek-chat', providerID: 'deepseek' } });
  const sid = s.data.data.id;
  console.log('session:', sid);

  await new Promise((r) => setTimeout(r, 1200));
  await j('POST', `/api/session/${sid}/prompt`, { prompt: { text: '运行 npm test 并告诉我结果' } });
  console.log('prompt sent, waiting for permission.v2.asked...');

  const perm = await waitFor(() => perms.length > 0 ? perms[0] : null, 180000, 'permission.v2.asked');
  const rid = perm.id;
  const psid = perm.sessionID || sid;
  console.log(`permission request: id=${rid} session=${psid} action=${JSON.stringify(perm.action || perm)}`.slice(0, 300));

  const detail = await j('GET', `/api/session/${psid}/permission/${rid}`);
  console.log('permission detail:', JSON.stringify(detail.data).slice(0, 500));

  console.log('-- replying once --');
  await j('POST', `/api/session/${psid}/permission/${rid}/reply`, { reply: 'once' });
  console.log('reply sent');

  await waitFor(async () => {
    const m = await j('GET', `/api/session/${sid}/message`);
    return /pass|fail/i.test(JSON.stringify(m.data)) && /1 passed|failing|tests/i.test(JSON.stringify(m.data)) ? m.data : null;
  }, 240000, 'npm test output');

  const m = await j('GET', `/api/session/${sid}/message`);
  console.log('FINAL MESSAGES:', JSON.stringify(m.data).slice(0, 1800));
  console.log('OBSERVED EVENT TYPES:', [...new Set(events)].join(', '));
  console.log('VALIDATION DONE');
  process.exit(0);
}

main().catch((e) => { console.log('FAILED:', e.message); process.exit(1); });
