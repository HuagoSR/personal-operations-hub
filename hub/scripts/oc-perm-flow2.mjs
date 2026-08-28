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

const seen = [];

async function main() {
  const s = await j('POST', '/api/session', { location: { directory: '/home/huagosr/worker-sandbox/calc' }, model: { id: 'deepseek-chat', providerID: 'deepseek' } });
  const sid = s.data.data.id;
  console.log('session:', sid);

  const sse = async () => {
    const res = await fetch(`${BASE}/event`, { headers: { accept: 'text/event-stream' } });
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
              if ((ev.type || '').includes('permission') || (ev.type || '').includes('question')) {
                console.log('EVENT:', JSON.stringify(ev).slice(0, 500));
                seen.push(ev);
              }
            } catch (e) { }
          }
        }
      }
    }
  };

  sse().catch(() => {});

  await new Promise((r) => setTimeout(r, 1000));

  console.log('== prompt (run tests) ==');
  await j('POST', `/api/session/${sid}/prompt`, { prompt: { text: '杩愯 npm test 骞跺憡璇夋垜缁撴灉' } });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const v1 = await j('GET', '/permission');
    if (v1.data && v1.data.length > 0) {
      console.log('V1 PERMISSION LIST:', JSON.stringify(v1.data).slice(0, 600));
      break;
    }
    const v2 = await j('GET', '/api/permission/request');
    if (v2.data && v2.data.data && v2.data.data.length > 0) {
      console.log('V2 PERMISSION LIST:', JSON.stringify(v2.data.data).slice(0, 600));
      break;
    }
    if (seen.length > 0) break;
    if (i % 5 === 4) console.log(`  still waiting (${(i + 1) * 2}s), no permission visible`);
  }
  const m = await j('GET', `/api/session/${sid}/message`);
  console.log('messages:', JSON.stringify(m.data).slice(0, 600));
  console.log('DONE');
  process.exit(0);
}

main().catch((e) => { console.log('FAILED:', e.message); process.exit(1); });

