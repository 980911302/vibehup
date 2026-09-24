/**
 * VibeHub 四场景端到端总验收（步骤 08 §8.2 剧本）。
 * 前置：服务已启动（DATABASE_URL 指向 pg 容器）、数据库为空（验收前 TRUNCATE）。
 * 双库分离（R64）后：MCP 子进程必须与 HTTP 服务同库——DATABASE_URL 从 server/.env 派生
 * （可用 ACCEPTANCE_DATABASE_URL 覆盖），禁止硬编码（R66 曾因此密钥查无→启动即退→超时）。
 * 运行：node scripts/final-acceptance.mjs
 */
/** VibeHub 四场景端到端总验收脚本（步骤 08 §8.2） */
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3210';

// MCP 子进程连接串：与 HTTP 服务同库（server/.env 的 DATABASE_URL）
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
// MCP 子进程工作目录 = server/（src/mcp-entry.ts 相对于此）。
// 必须 fileURLToPath 解码：URL.pathname 会把中文路径百分号编码，目录不存在 → spawn ENOENT（R76 抓到）
const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
function deriveDbUrl() {
  if (process.env.ACCEPTANCE_DATABASE_URL) return process.env.ACCEPTANCE_DATABASE_URL;
  try {
    const text = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const m = /^\s*DATABASE_URL\s*=\s*"?([^"\n\r]+)"?/m.exec(text);
    if (m) return m[1];
  } catch {
    // .env 缺失走默认
  }
  return 'postgresql://postgres:test@127.0.0.1:55432/postgres';
}
const DB_URL = deriveDbUrl();
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); cond ? pass++ : fail++; };
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
// 兼容模式：传入 Response 或已解析对象均可
const J = async (x) => (x && typeof x.json === 'function' ? await x.json() : x ?? {});
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const HD = (t) => ({ authorization: `Bearer ${t}` });   // DELETE 无 body，不带 content-type

// 生成测试 PNG
async function makePng(color, text) {
  // 用 sharp 造测试图（server 的正式依赖；裸名 import 在 scripts/ 下可正常解析）
  const sharp = (await import('sharp')).default;
  const svg = `<svg width="1200" height="800"><rect width="1200" height="800" fill="${color}"/><text x="60" y="420" font-family="sans-serif" font-size="90" fill="#fff">${text}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function multipartUpload(token, projectId, filename, contentType, buffer) {
  const fd = new FormData();
  fd.append('project_id', projectId);
  fd.append('files', new File([buffer], filename, { type: contentType }));
  const r = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
  return j(r);
}

console.log('════════ 场景 A：冷启动与身份治理 ════════');
// A1 注册第一个用户 = Owner
const ownerReg = await J(await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@final.com', password: 'abcd1234', name: '最终验收Owner' }) }))
ok('A1 首位注册用户=Owner', ownerReg.user?.role === 'owner', ownerReg.user?.role);
const OT = ownerReg.access_token;

// A2 第二个用户 = member
const memReg = await J(await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dev@final.com', password: 'abcd1234', name: '开发同学' }) }))
ok('A2 第二个用户=member', memReg.user?.role === 'member');
const MT = memReg.access_token;

// A3 成员列表 2 人
const members = await J(await fetch(`${BASE}/api/users`, { headers: H(OT) }))
ok('A3 成员列表 2 人', Array.isArray(members) && members.length === 2);

// A4 注册开关：关闭 → 注册被拒 → 开启
await fetch(`${BASE}/api/system`, { method: 'PATCH', headers: H(OT), body: JSON.stringify({ registration_open: 'false' }) });
const regClosed = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@final.com', password: 'abcd1234', name: 'X' }) });
ok('A4 关闭注册后新注册被拒', regClosed.status === 403, '状态 ' + regClosed.status);
await fetch(`${BASE}/api/system`, { method: 'PATCH', headers: H(OT), body: JSON.stringify({ registration_open: 'true' }) });

// A5 member 不能改成员角色（RBAC）
const roleTry = await fetch(`${BASE}/api/users/${memReg.user.id}`, { method: 'PATCH', headers: H(MT), body: JSON.stringify({ role: 'admin' }) });
ok('A5 member 改角色 403', roleTry.status === 403);

console.log('════════ 场景 B：人的闭环（录入→指派→修复→验收→重开） ════════');
const proj = await J(await fetch(`${BASE}/api/projects`, { method: 'POST', headers: H(OT), body: JSON.stringify({ name: '验收项目' }) }))
ok('B1 创建项目', !!proj.id);

// B2 上传附件（模拟粘贴截图）
const png = await makePng('#dc2626', 'Final Bug');
const up = await multipartUpload(MT, proj.id, 'final-shot.png', 'image/png', png);
const attId = up.attachments?.[0]?.id;
ok('B2 上传截图拿 attachment_id', !!attId, attId);
ok('B3 uploaded_by=上传者', up.attachments?.[0]?.uploaded_by === memReg.user.id);

// B4 建缺陷（关联附件）
const bug = await J(await fetch(`${BASE}/api/bugs`, { method: 'POST', headers: H(MT), body: JSON.stringify({ project_id: proj.id, title: '最终验收：支付超时', severity: 'critical', attachment_ids: [attId] }) }))
ok('B4 建缺陷关联附件', !!bug.id);

// B5 状态机：open→in_progress→resolved（合法），open→resolved（非法）
await fetch(`${BASE}/api/bugs/${bug.id}`, { method: 'PATCH', headers: H(MT), body: JSON.stringify({ status: 'in_progress' }) });
const legal = await fetch(`${BASE}/api/bugs/${bug.id}`, { method: 'PATCH', headers: H(MT), body: JSON.stringify({ status: 'resolved', resolution_notes: '已修复：加大超时', git_commit_hash: 'final123' }) });
ok('B5 状态机合法流转 resolved', legal.status === 200 && (await legal.json()).status === 'resolved');

const bug2 = await J(await fetch(`${BASE}/api/bugs`, { method: 'POST', headers: H(MT), body: JSON.stringify({ project_id: proj.id, title: '非法流转测试' }) }))
const illegal = await fetch(`${BASE}/api/bugs/${bug2.id}`, { method: 'PATCH', headers: H(MT), body: JSON.stringify({ status: 'resolved' }) });
ok('B6 open→resolved 非法被拒', illegal.status === 400 && (await illegal.json()).error.message.includes('不能从'));

// B7 重开需 reason
const reopened = await fetch(`${BASE}/api/bugs/${bug.id}`, { method: 'PATCH', headers: H(MT), body: JSON.stringify({ status: 'open' }) });
ok('B7 无 reason 重开被拒', reopened.status === 400 && (await reopened.json()).error.message.includes('重开原因'));
const reopened2 = await fetch(`${BASE}/api/bugs/${bug.id}`, { method: 'PATCH', headers: H(MT), body: JSON.stringify({ status: 'open', reopen_reason: '复验不通过' }) });
ok('B8 带 reason 重开+reopened_count=1', reopened2.status === 200 && (await reopened2.json()).reopened_count === 1);

// B9 评论 + 活动流
await fetch(`${BASE}/api/bugs/${bug.id}/comments`, { method: 'POST', headers: H(MT), body: JSON.stringify({ content: '已定位：连接池耗尽' }) });
const comments = await J(await fetch(`${BASE}/api/bugs/${bug.id}/comments`, { headers: H(MT) }))
ok('B9 活动流含状态变更+评论', Array.isArray(comments) && comments.length >= 3 && comments.some((c) => c.content.includes('重开原因')), `${comments.length} 条`);

console.log('════════ 场景 C：AI 的闭环（MCP 全链路） ════════');
// C1 创建密钥（全 scope）
const keyRes = await J(await fetch(`${BASE}/api/api-keys`, { method: 'POST', headers: H(OT), body: JSON.stringify({ name: 'final-ai', scopes: ['context:read','attachment:read','attachment:write','bug:write','note:write','task:read','task:write','admin'] }) }))
ok('C1 创建 MCP 密钥（一次性明文）', keyRes.key?.startsWith('vhk_live_'), keyRes.key?.slice(0, 16) + '…');

// C2 MCP 传输：默认 stdio（本地子进程，DATABASE_URL=DB_URL）；
// MCP_TRANSPORT=sse 走 HTTP SSE（容器部署形态——IDE 连容器即此路，Bearer 鉴权）
const { spawn } = await import('node:child_process');
let nextId = 1;
const TIMEOUT_MS = 20000;

function stdioTransport(apiKey) {
  const server = spawn('npx', ['tsx', 'src/mcp-entry.ts'], {
    cwd: SERVER_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: DB_URL, VIBEHUB_API_KEY: apiKey },
  });
  let buf = '';
  const pending = new Map();
  server.stdout.on('data', (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try { const m = JSON.parse(line); if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {}
    }
  });
  server.stderr.on('data', () => {});
  const send = (method, params) => new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, res);
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS);
  });
  const notify = (method) => server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  return { send, notify, close: () => server.kill() };
}

async function sseTransport(apiKey) {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/mcp/sse`, { headers: { authorization: `Bearer ${apiKey}` }, signal: ac.signal });
  if (!res.ok || !res.body) throw new Error(`SSE 握手失败 HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const pending = new Map();
  let buf = '';
  let sessionId = null;
  const readLoop = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
          let evt = 'message', data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event: ')) evt = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (evt === 'endpoint') {
            const m = /sessionId=([^&\s]+)/.exec(data);
            if (m) sessionId = decodeURIComponent(m[1]);
          } else if (data) {
            try { const msg = JSON.parse(data); if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } } catch {}
          }
        }
      }
    } catch {
      // 流中断：pending 由各自超时拒绝
    }
  })();
  const t0 = Date.now();
  while (!sessionId && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
  if (!sessionId) { ac.abort(); throw new Error('SSE 握手超时：未取得 sessionId'); }
  const send = (method, params) => new Promise((res2, rej) => {
    const id = nextId++;
    pending.set(id, res2);
    fetch(`${BASE}/mcp/messages?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    }).catch(rej);
    setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS);
  });
  const notify = async (method) => {
    await fetch(`${BASE}/mcp/messages?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ jsonrpc: '2.0', method }),
    });
  };
  return { send, notify, close: () => ac.abort() };
}

const mcp = process.env.MCP_TRANSPORT === 'sse'
  ? await sseTransport(keyRes.key)
  : stdioTransport(keyRes.key);
const { send, close: closeMcp } = mcp;
const callTool = (name, args = {}) => send('tools/call', { name, arguments: args });
const text = (r) => (r.result?.content ?? []).map((c) => c.text).join('\n');


await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'final', version: '1' } });
await mcp.notify('notifications/initialized');

const toolsList = await send('tools/list', {});
ok('C2 tools/list = 15', toolsList.result?.tools?.length === 15);

const ctx = JSON.parse(text(await callTool('get_project_context', { project_slug: proj.slug })))
ok('C3 get_project_context 见缺陷', ctx.open_bugs?.length >= 1, `open=${ctx.open_bugs?.length}`);

const up2 = JSON.parse(text(await callTool('upload_attachment', { project_slug: proj.slug, bug_id: bug.id, file_name: 'ai-stack.log', file_type: 'text/plain', data_base64: Buffer.from(Array.from({length: 60}, (_, i) => i === 9 ? 'ERROR AI stacktrace at Foo.bar' : `log line ${i}`).join('\n')).toString('base64') })))
ok('C4 AI 贴回日志附件', up2.ok === true && up2.attachment.file_name === 'ai-stack.log');
const txt = JSON.parse(text(await callTool('read_attachment_text', { attachment_id: up2.attachment.id, grep_keyword: 'ERROR' })));
ok('C5 read_attachment_text 分片+grep', txt.total_lines === 1 && txt.content.includes('ERROR'), `命中 ${txt.total_lines} 行`);

const img = JSON.parse(text(await callTool('inspect_image_asset', { attachment_id: attId, target_max_dimension: 540, return_mode: 'base64' })))
ok('C6 inspect_image_asset 降采样 base64', img.width === 540 && img.base64?.length > 100, `${img.width}px`);

const cmt = await callTool('add_bug_comment', { bug_id: bug.id, content: 'AI：已定位连接池配置过小' });
ok('C7 add_bug_comment', cmt.result?.isError !== true);

const updRejected = await callTool('update_bug_status', { bug_id: bug2.id, status: 'resolved', resolution_notes: 'AI 修复' })
ok('C8a MCP 链路状态机生效（open→resolved 被拒）', updRejected.result?.isError === true, text(updRejected).slice(0, 40))
await callTool('update_bug_status', { bug_id: bug2.id, status: 'in_progress' })
const upd = await callTool('update_bug_status', { bug_id: bug2.id, status: 'resolved', resolution_notes: 'AI 已修复', commit_hash: 'aifinal1' })
const updData = JSON.parse(text(upd));
ok('C8b MCP 合法流转+回填 commit', updData.ok === true && updData.bug.git_commit_hash === 'aifinal1');


// C9 撤销密钥 → MCP 拒识（stdio 模式：新进程启动即退 1；sse 模式：握手 401）
const revokeRes = await fetch(`${BASE}/api/api-keys/${keyRes.api_key.id}`, { method: 'DELETE', headers: HD(OT) });
if (process.env.MCP_TRANSPORT === 'sse') {
  const ac = new AbortController();
  const r = await fetch(`${BASE}/mcp/sse`, { headers: { authorization: `Bearer ${keyRes.key}` }, signal: ac.signal }).catch(() => null);
  ac.abort();
  ok('C9 撤销密钥后 SSE 握手 401', r?.status === 401, 'status=' + (r?.status ?? 'ERR'));
} else {
  const server2 = spawn('npx', ['tsx', 'src/mcp-entry.ts'], {
    cwd: SERVER_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: DB_URL, VIBEHUB_API_KEY: keyRes.key },
  });
  const exitCode = await new Promise((res) => {
    const t = setTimeout(() => { server2.kill('SIGKILL'); res(-1); }, 20000);
    server2.on('exit', (c) => { clearTimeout(t); res(c); });
  });
  ok('C9 撤销密钥后 MCP 启动即失败', exitCode === 1, 'exit=' + exitCode);
}
closeMcp();

console.log('════════ 场景 D：治理闭环 ════════');
// D1 成员文件我的过滤
const mine = await J(await fetch(`${BASE}/api/attachments?mine=true`, { headers: H(MT) }))
ok('D1 我的文件只含自己的', Array.isArray(mine) && mine.every((a) => a.uploaded_by === memReg.user.id), `${mine.length} 个`);

// D2 删除自己的文件
const delOwn = await fetch(`${BASE}/api/attachments/${attId}`, { method: 'DELETE', headers: HD(MT) });
ok('D2 成员删自己的文件 204', delOwn.status === 204);

// D3 移除成员 → 数据保留
await fetch(`${BASE}/api/users/${memReg.user.id}`, { method: 'DELETE', headers: HD(OT) });
const bugsAfter = await J(await fetch(`${BASE}/api/bugs?project_id=${proj.id}`, { headers: H(OT) }))
ok('D3 移除成员后缺陷保留', bugsAfter.total >= 2, `剩 ${bugsAfter.total} 个`);

// D4 Owner 转让
const admin2 = await J(await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'newowner@final.com', password: 'abcd1234', name: '新Owner' }) }))
await fetch(`${BASE}/api/users/${admin2.user.id}`, { method: 'PATCH', headers: H(OT), body: JSON.stringify({ role: 'admin' }) });
const transfer = await fetch(`${BASE}/api/users/transfer-ownership`, { method: 'POST', headers: H(OT), body: JSON.stringify({ target_user_id: admin2.user.id }) });
ok('D4 Owner 转让成功', transfer.status === 204);
const afterTransfer = await J(await fetch(`${BASE}/api/users`, { headers: H(OT) }))
const roles = Object.fromEntries(afterTransfer.map((u) => [u.email, u.role]));
ok('D5 角色互换（newowner=owner, 原owner=admin）', roles['newowner@final.com'] === 'owner' && roles['owner@final.com'] === 'admin', JSON.stringify(roles));

// D6 用量审计一致
const usageEvents = await (await fetch(`${BASE}/api/api-keys/${keyRes.api_key.id}/usage`, { headers: H(OT) })).json();
ok('D6 密钥用量有记录', usageEvents.total >= 6, `total=${usageEvents.total}`);

console.log(`\n════════ 总验收结果: ${pass} PASS / ${fail} FAIL ════════`);
process.exit(fail > 0 ? 1 : 0);
