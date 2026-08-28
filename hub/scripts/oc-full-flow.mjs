import fs from 'fs';

const BASE = 'http://127.0.0.1:4096';
const perms = [];
const events = [];
let sid = null;

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
            console.log(`[PERM] ${JSON.stringify(p.properties).slice(0, 260)}`);
          } else if (t && (t.startsWith('session.next.step') || t === 'session.idle' || t === 'session.error')) {
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
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function replyNextPermission(timeoutMs) {
  const perm = await waitFor(() => perms.shift() || null, timeoutMs, 'next permission');
  const rid = perm.id;
  await j('POST', `/api/session/${sid}/permission/${rid}/reply`, { reply: 'once' });
  console.log(`permission replied: ${perm.action} (${rid})`);
  return perm;
}

async function main() {
  sse('/global/event', 'GE').catch(() => {});

  console.log('== create session ==');
  const s = await j('POST', '/api/session', { location: { directory: '/home/huagosr/worker-sandbox/calc' }, model: { id: 'deepseek-chat', providerID: 'deepseek' } });
  sid = s.data.data.id;
  console.log('session:', sid);
  await new Promise((r) => setTimeout(r, 1200));

  console.log('== task: fix the bug and make all tests pass ==');
  await j('POST', `/api/session/${sid}/prompt`, { prompt: { text: '请修复 calc 项目中 subtract 函数的 bug，使 npm test 全部通过。修复完成后告诉我修改内容。' } });
  console.log('waiting for edit permission...');
  await replyNextPermission(180000);
  console.log('waiting for bash permission (run tests)...');
  await replyNextPermission(180000);
  console.log('waiting for second bash permission (verify)...');
  try { await replyNextPermission(90000); } catch (e) { console.log('(no third permission, ok)'); }

  await waitFor(async () => {
    const m = await j('GET', `/api/session/${sid}/message`);
    return /pass 5|5 passed|pass:\s*5|全部通过|通过/.test(JSON.stringify(m.data)) ? m.data : null;
  }, 300000, 'all tests passing');
  console.log('== TASK COMPLETED ==');

  const m = await j('GET', `/api/session/${sid}/message`);
  const msgList = (m.data && m.data.data) || [];
  for (const msg of msgList.reverse()) {
    for (const c of (msg.content || [])) {
      if (c.type === 'tool' && c.state && c.state.output) {
        console.log('TOOL OUTPUT:', JSON.stringify(c.state.output).slice(0, 300));
      }
      if (c.type === 'text') console.log('TEXT:', c.text.slice(0, 300));
    }
  }

  console.log('== diff ==');
  const d = await j('GET', `/api/session/${sid}/diff`);
  console.log('diff:', JSON.stringify(d.data).slice(0, 500));

  console.log('== resume: ask in same session ==');
  await j('POST', `/api/session/${sid}/prompt`, { prompt: { text: '一句话回答：你刚才修改的是哪个函数？' } });
  await waitFor(async () => {
    const m2 = await j('GET', `/api/session/${sid}/message`);
    return /subtract/.test(JSON.stringify(m2.data)) && m2.data.length >= 4 ? m2.data : null;
  }, 180000, 'resume answer');
  console.log('== RESUME OK ==');

  console.log('== interrupt test ==');
  await j('POST', `/api/session/${sid}/prompt`, { prompt: { text: '从 1 数到 500，每行一个数字。' } });
  await new Promise((r) => setTimeout(r, 3000));
  const ir = await j('POST', `/api/session/${sid}/interrupt`);
  console.log('interrupt status:', ir.status);
  await new Promise((r) => setTimeout(r, 1500));
  console.log('== INTERRUPT DONE ==');

  console.log('event types:', [...new Set(events)].join(', '));
  console.log('ALL VALIDATION DONE');
  process.exit(0);
}

main().catch((e) => { console.log('FAILED:', e.message); process.exit(1); });
