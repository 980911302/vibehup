/**
 * 一次性：验证 MCP 密钥在两种传输下均可用（stdio 与 SSE 容器同款）。
 * 用法：KEY=vhk_live_xxx node scripts/verify-mcp-key.mjs
 */
import { spawn } from 'node:child_process';

const KEY = process.env.KEY;
if (!KEY) {
  console.error('需要 KEY=vhk_live_... 环境变量');
  process.exit(1);
}
const BASE = process.env.BASE ?? 'http://127.0.0.1:3210';
const DB = process.env.DATABASE_URL ?? 'postgresql://vibehub:vibehub@127.0.0.1:55433/vibehub';
const TIMEOUT = 20_000;

let pass = 0;
let fail = 0;
const ok = (m, extra = '') => { pass++; console.log(`  PASS ${m}${extra ? ` — ${extra}` : ''}`); };
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };

/** ---- stdio 传输 ---- */
function stdioClient() {
  const child = spawn('npx', ['tsx', 'src/mcp-entry.ts'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: DB, VIBEHUB_API_KEY: KEY },
  });
  let buf = '';
  const pending = new Map();
  let id = 1;
  child.stdout.on('data', (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const m = JSON.parse(line);
        if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      } catch { /* stdout 只应有 JSON-RPC */ }
    }
  });
  child.stderr.on('data', () => {});
  const send = (method, params) =>
    new Promise((res, rej) => {
      const i = id++;
      pending.set(i, res);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`);
      setTimeout(() => rej(new Error(`${method} 超时`)), TIMEOUT);
    });
  return { send, notify: (m) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: m })}\n`), close: () => child.kill() };
}

/** ---- SSE 传输（容器/IDE 远程接入同款） ---- */
async function sseClient() {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/mcp/sse`, { headers: { authorization: `Bearer ${KEY}` }, signal: ac.signal });
  if (!res.ok || !res.body) throw new Error(`SSE 握手失败 HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const pending = new Map();
  let sessionId = null;
  let id = 1;
  let buf = '';
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let evt = 'message';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event: ')) evt = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (evt === 'endpoint') {
            const m = /sessionId=([^&\s]+)/.exec(data);
            if (m) sessionId = decodeURIComponent(m[1]);
          } else if (data) {
            try {
              const msg = JSON.parse(data);
              if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
            } catch { /* ignore */ }
          }
        }
      }
    } catch { /* aborted */ }
  })();
  const waitSession = async () => {
    for (let i = 0; i < 100 && !sessionId; i++) await new Promise((r) => setTimeout(r, 50));
    if (!sessionId) throw new Error('未拿到 sessionId');
  };
  const send = async (method, params) => {
    await waitSession();
    const i = id++;
    const p = new Promise((res, rej) => {
      pending.set(i, res);
      setTimeout(() => rej(new Error(`${method} 超时`)), TIMEOUT);
    });
    const post = await fetch(`${BASE}/mcp/messages?sessionId=${sessionId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: i, method, params }),
    });
    if (post.status !== 202) throw new Error(`消息投递失败 HTTP ${post.status}`);
    return p;
  };
  const notify = async (method) => {
    await waitSession();
    await fetch(`${BASE}/mcp/messages?sessionId=${sessionId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method }),
    });
  };
  return { send, notify, close: () => ac.abort() };
}

async function runSuite(label, client) {
  console.log(`\n── ${label} ──`);
  const init = await client.send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'verify', version: '1' },
  });
  init.result?.serverInfo?.name === 'vibehub'
    ? ok('initialize 握手', `server=${init.result.serverInfo.name} v${init.result.serverInfo.version}`)
    : bad(`initialize 异常: ${JSON.stringify(init).slice(0, 200)}`);
  await client.notify('notifications/initialized');

  const list = await client.send('tools/list', {});
  const tools = list.result?.tools ?? [];
  tools.length === 27 ? ok('tools/list 返回 27 个工具') : bad(`工具数 ${tools.length} ≠ 27`);

  const ctx = await client.send('tools/call', { name: 'get_project_context', arguments: {} });
  const ctxText = ctx.result?.content?.[0]?.text ?? '';
  !ctx.result?.isError && ctxText.includes('白泽团队')
    ? ok('get_project_context 读到项目上下文', '命中「白泽团队」')
    : bad(`get_project_context 异常: ${ctxText.slice(0, 200)}`);

  const created = await client.send('tools/call', {
    name: 'create_bug',
    arguments: { project_slug: '白泽团队', title: `MCP 连通性自检 ${new Date().toISOString().slice(11, 19)}`, severity: 'low' },
  });
  const createdText = created.result?.content?.[0]?.text ?? '';
  let bugId = null;
  try { bugId = JSON.parse(createdText).bug?.id ?? JSON.parse(createdText).id; } catch { /* ignore */ }
  bugId ? ok('create_bug 写入成功（bug:write scope 生效）', bugId) : bad(`create_bug 失败: ${createdText.slice(0, 200)}`);

  if (bugId) {
    const moved = await client.send('tools/call', {
      name: 'update_bug_status',
      arguments: { bug_id: bugId, status: 'in_progress' },
    });
    const movedText = moved.result?.content?.[0]?.text ?? '';
    !moved.result?.isError ? ok('update_bug_status 回填成功', 'open → in_progress') : bad(`update_bug_status 失败: ${movedText.slice(0, 200)}`);
    const detail = await client.send('tools/call', { name: 'get_bug_detail', arguments: { bug_id: bugId } });
    (detail.result?.content?.[0]?.text ?? '').includes('in_progress')
      ? ok('get_bug_detail 读回新状态')
      : bad('get_bug_detail 未反映新状态');
    console.log(`  ℹ️ 自检缺陷 ID: ${bugId}（可在看板删掉）`);
  }

  const denied = await client.send('tools/call', { name: 'purge_trash', arguments: {} });
  denied.result?.isError ? ok('越权调用被拒（scope 生效：无 admin）') : bad('purge_trash 竟然成功——scope 未生效！');
}

console.log(`目标: ${BASE}  密钥: ${KEY.slice(0, 14)}…`);
const stdio = stdioClient();
await runSuite('stdio 传输（本地 IDE 子进程）', stdio);
stdio.close();

const sse = await sseClient();
await runSuite('SSE 传输（HTTP，容器/远程同款）', sse);
sse.close();

console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
