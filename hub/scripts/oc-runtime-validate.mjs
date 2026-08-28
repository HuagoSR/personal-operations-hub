import fs from 'fs';

const BASE = 'http://127.0.0.1:4096';
const DIR = '/home/huagosr/worker-sandbox/calc';
const LOG = [];
const events = [];

function log(s) {
  LOG.push(`[${new Date().toISOString()}] ${s}`);
  console.log(s);
}

async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = text.slice(0, 300); }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return { status: res.status, data };
}

async function readEvents(sid) {
  const res = await fetch(`${BASE}/api/session/${sid}/event`, { headers: { accept: 'text/event-stream' } });
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
            events.push(ev);
            const t = ev.type || ev.event || 'unknown';
            log(`  EVENT: ${t} ${JSON.stringify(ev).slice(0, 220)}`);
          } catch (e) { /* keepalive */ }
        }
      }
    }
  }
}

async function waitFor(pred, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await pred();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function messages(sid) {
  const r = await j('GET', `/api/session/${sid}/message`);
  return r.data;
}

async function main() {
  log('== 1. create session ==');
  const s = await j('POST', '/api/session', { location: { directory: DIR } });
  const sid = s.data.data.id;
  log(`session: ${sid}`);

  const evTask = readEvents(sid).catch((e) => log(`event stream ended: ${e.message}`));

  log('== 2. simple prompt (PONG) ==');
  await j('POST', `/api/session/${sid}/prompt`, { prompt: { text: 'Reply with exactly: PONG' } });
  await waitFor(async () => {
    const m = await messages(sid);
    const joined = JSON.stringify(m);
    return joined.includes('PONG') ? m : null;
  }, 120000, 'PONG reply');
  const msgs1 = await messages(sid);
  const textParts1 = msgs1.flatMap ? msgs1.flatMap((m) => (m.parts || []).filter((p) => p.type === 'text').map((p) => p.text)) : msgs1;
  log(`PONG reply received. sample=${JSON.stringify(textParts1).slice(0, 200)}`);

  log('== 3. permission flow (run tests, bash=ask) ==');
  await j('POST', `/api/session/${sid}/prompt`, { prompt: { text: '杩愯 npm test 骞跺憡璇夋垜娴嬭瘯缁撴灉' } });
  const perm = await waitFor(() => {
    const e = events.find((x) => (x.type || '').includes('permission') && !(x.type || '').includes('replied'));
    return e || null;
  }, 120000, 'permission request event');
  log(`permission event type=${perm.type}`);
  const rid = perm.id || (perm.permission && perm.permission.id);
  const req = await j('GET', `/api/session/${sid}/permission/${rid}`);
  log(`permission detail: action=${req.data.data.action} resources=${JSON.stringify(req.data.data.resources)}`);
  await j('POST', `/api/session/${sid}/permission/${rid}/reply`, { reply: 'once' });
  log('permission replied once');
  await waitFor(async () => {
    const m = await messages(sid);
    const s2 = JSON.stringify(m);
    return (s2.includes('pass') || s2.includes('fail') || s2.includes('娴嬭瘯')) ? m : null;
  }, 120000, 'test result message');
  log('test run completed');

  log('== 4. session resume (continue same session) ==');
  await j('POST', `/api/session/${sid}/prompt`, { prompt: { text: 'In one short sentence, confirm which directory this session is working in.' } });
  await waitFor(async () => {
    const m = await messages(sid);
    return JSON.stringify(m).includes('calc') ? m : null;
  }, 120000, 'resume reply mentioning calc');
  log('resume OK');

  log('== 5. interrupt test ==');
  await j('POST', `/api/session/${sid}/prompt`, { prompt: { text: 'Count from 1 to 200, one number per line.' } });
  await new Promise((r) => setTimeout(r, 2500));
  const ir = await j('POST', `/api/session/${sid}/interrupt`);
  log(`interrupt status=${ir.status}`);
  await new Promise((r) => setTimeout(r, 2000));
  log('interrupt done');

  log('== event types observed ==');
  const types = [...new Set(events.map((e) => e.type))];
  log(types.join(', '));

  fs.writeFileSync('/tmp/oc-runtime-events.json', JSON.stringify(events, null, 2));
  log('VALIDATION DONE');
}

main().catch((e) => {
  log(`FAILED: ${e.message}`);
  fs.writeFileSync('/tmp/oc-runtime-events.json', JSON.stringify(events, null, 2));
  process.exit(1);
});

