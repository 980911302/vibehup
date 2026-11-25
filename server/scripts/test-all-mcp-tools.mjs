/**
 * 9 个核心 MCP 工具逐个实测（走 SSE 传输，与容器/远端 IDE 交付形态一致）。
 * 用法：KEY=vhk_live_xxx node scripts/test-all-mcp-tools.mjs
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3210';
const DB = process.env.DATABASE_URL ?? 'postgresql://vibehub:vibehub@127.0.0.1:55433/vibehub';
const KEY = process.env.KEY;
if (!KEY) {
  console.error('需要 KEY=vhk_live_... 环境变量');
  process.exit(1);
}

const SLUG = `mcp-tool-test-${Date.now()}`;
const LONG = 'X'.repeat(800);
const LOG_TEXT = [
  '2026-09-23 10:00:01 INFO  启动服务',
  '2026-09-23 10:00:03 ERROR TypeError: Cannot read properties of undefined',
  '2026-09-23 10:00:05 INFO  重试成功',
].join('\n');
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: DB } } });
const project = await prisma.project.create({ data: { id: `prj_${randomBytes(6).toString('hex')}`, name: 'MCP 9 工具自检', slug: SLUG } });
const otherProj = await prisma.project.create({ data: { id: `prj_${randomBytes(6).toString('hex')}`, name: '隔离参照项目', slug: `${SLUG}-b` } });
const longBug = await prisma.bug.create({
  data: { id: `bug_${randomBytes(6).toString('hex')}`, projectId: project.id, title: '长文本缺陷（验证 500 字符截断）', actualResult: LONG, severity: 'low' },
});
mkdirSync(path.join(SERVER_DIR, 'test-data'), { recursive: true });
const logPath = path.join(SERVER_DIR, 'test-data', 'mcp-selftest.log');
writeFileSync(logPath, LOG_TEXT);
const logAtt = await prisma.attachment.create({
  data: {
    id: `att_${randomBytes(6).toString('hex')}`, projectId: project.id, entityType: 'bug', entityId: longBug.id,
    fileName: 'stacktrace.log', fileType: 'text/plain', fileSize: Buffer.byteLength(LOG_TEXT),
    storagePath: logPath, uploadedBy: 'human',
  },
});
const imgPath = path.join(SERVER_DIR, 'test-data', 'mcp-selftest.png');
writeFileSync(imgPath, Buffer.from(PNG_B64, 'base64'));
const imgAtt = await prisma.attachment.create({
  data: {
    id: `att_${randomBytes(6).toString('hex')}`, projectId: project.id, entityType: 'bug', entityId: longBug.id,
    fileName: 'shot.png', fileType: 'image/png', fileSize: 100,
    storagePath: imgPath, uploadedBy: 'human', width: 1, height: 1,
  },
});
await prisma.skill.create({
  data: {
    id: `skl_${randomBytes(6).toString('hex')}`,
    projectId: project.id,
    name: 'selftest-skill',
    description: '自检技能描述',
    content: '---\nname: selftest-skill\ndescription: 自检技能描述\n---\n\n# Selftest\n',
    source: 'web',
  },
});

const ac = new AbortController();
const res = await fetch(`${BASE}/mcp/sse`, { headers: { authorization: `Bearer ${KEY}` }, signal: ac.signal });
if (!res.ok) { console.error(`SSE 握手失败 HTTP ${res.status}`); process.exit(1); }
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
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        let evt = 'message'; let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) evt = line.slice(7).trim();
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (evt === 'endpoint') { const m = /sessionId=([^&\s]+)/.exec(data); if (m) sessionId = decodeURIComponent(m[1]); }
        else if (data) {
          try { const msg = JSON.parse(data); if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } } catch { /* ignore */ }
        }
      }
    }
  } catch { /* aborted */ }
})();
const waitSession = async () => { for (let i = 0; i < 100 && !sessionId; i++) await new Promise((r) => setTimeout(r, 50)); if (!sessionId) throw new Error('未拿到 sessionId'); };
async function send(method, params) {
  await waitSession();
  const i = id++;
  const p = new Promise((resolve, reject) => { pending.set(i, resolve); setTimeout(() => reject(new Error(`${method} 超时`)), 30_000); });
  const post = await fetch(`${BASE}/mcp/messages?sessionId=${sessionId}`, {
    method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: i, method, params }),
  });
  if (post.status !== 202) throw new Error(`投递失败 HTTP ${post.status}`);
  return p;
}
async function call(name, args = {}) {
  const r = await send('tools/call', { name, arguments: args });
  const text = r.result?.content?.[0]?.text ?? '';
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { raw: r, text, json, isError: r.result?.isError ?? false };
}

await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'tool-test', version: '1' } });
const list = await send('tools/list', {});
const toolNames = (list.result?.tools ?? []).map((t) => t.name);
console.log(`── 工具清单（${toolNames.length} 个）──\n${toolNames.join(', ')}\n`);

console.log('【1/9】get_project_context — 全景上下文（me + members + memory + skills + 工单）');
{
  const r = await call('get_project_context', { project_slug: SLUG });
  check('返回成功且包含 me / members / skills', !r.isError && !!r.json?.me && Array.isArray(r.json?.members) && r.json?.skills?.length === 1);
  const amb = await call('get_project_context', {});
  check('多项目省略 project_slug 触发防串项提示', amb.isError && amb.text.includes(SLUG));
}

console.log('\n【2/9】search — 列表与检索二合一');
{
  const listed = await call('search', { project_slug: SLUG, type: 'bug' });
  check('列表模式命中目标缺陷', !listed.isError && listed.json?.mode === 'list' && listed.text.includes('长文本缺陷'));
  const queried = await call('search', { q: '长文本', project_slug: SLUG });
  check('检索模式命中目标缺陷', !queried.isError && queried.json?.mode === 'query' && queried.json?.bugs?.length === 1);
}

console.log('\n【3/9】get_work_item — 详情与截断控制');
{
  const brief = await call('get_work_item', { id: longBug.id });
  check('默认 500 字符截断', !brief.isError && brief.json?.actual_result_truncated === true);
  const full = await call('get_work_item', { id: longBug.id, full: true });
  check('full=true 返回完整 800 字符', !full.isError && full.json?.actual_result?.length === 800);
}

let newBugId = '';
let newTaskId = '';
console.log('\n【4/9】create_work_item — 新建缺陷与任务');
{
  const b = await call('create_work_item', { type: 'bug', project_slug: SLUG, title: '自检新建缺陷' });
  newBugId = b.json?.bug?.id ?? '';
  check('新建 bug 成功', !b.isError && newBugId.startsWith('bug_'));
  const t = await call('create_work_item', { type: 'task', project_slug: SLUG, title: '自检新建任务', status: 'doing' });
  newTaskId = t.json?.task?.id ?? '';
  check('新建 task 成功', !t.isError && newTaskId.startsWith('tsk_'));
}

console.log('\n【5/9】update_work_item — 状态机、评论与证据');
{
  const skip = await call('update_work_item', { id: newBugId, status: 'resolved' });
  check('禁止跨级跳状态（open→resolved 被拒）', skip.isError);
  const okStep = await call('update_work_item', { id: newBugId, status: 'in_progress', comment: '开始排查' });
  check('合法推进 in_progress + 评论', !okStep.isError && okStep.json?.bug?.status === 'in_progress');
  const tStep = await call('update_work_item', { id: newTaskId, status: 'review', evidence: { tests: 'all green' } });
  check('任务推进 review + 交付证据', !tStep.isError && tStep.json?.task?.status === 'review');
}

console.log('\n【6/9】read_attachment — 自动识图与日志 grep');
{
  const logRead = await call('read_attachment', { attachment_id: logAtt.id, grep_keyword: 'ERROR' });
  check('日志 grep 精准命中 ERROR 行', !logRead.isError && logRead.json?.total_lines === 1);
  const imgRead = await call('read_attachment', { attachment_id: imgAtt.id });
  const hasImg = (imgRead.raw.result?.content ?? []).some((c) => c.type === 'image');
  check('图片自动返回 MCP image 视觉块', !imgRead.isError && hasImg);
}

console.log('\n【7/9】upload_attachment — 短文本直传与本地文件 curl 链接');
{
  const direct = await call('upload_attachment', { work_item_id: newBugId, file_name: 'note.txt', content: 'hello mcp' });
  check('传 content 直接生成附件', !direct.isError && direct.json?.mode === 'direct');
  const grant = await call('upload_attachment', { work_item_id: newBugId, file_name: 'shot2.png' });
  check('不传 content 签发一次性 curl 上传链接', !grant.isError && grant.json?.mode === 'upload_url');
  const put = await fetch(grant.json.upload_url, { method: 'PUT', body: Buffer.from(PNG_B64, 'base64') });
  check('PUT 直传成功 201', put.status === 201);
}

console.log('\n【8/9】append_note — 追加随手记');
{
  const n = await call('append_note', { project_slug: SLUG, content: '自检随手记', tags: ['selftest'] });
  check('创建项目随手记成功', !n.isError && n.json?.project_id === project.id);
}

console.log('\n【9/9】get_skill — 读取团队技能全文');
{
  const s = await call('get_skill', { project_slug: SLUG, name: 'selftest-skill' });
  check('取回 SKILL.md 全文', !s.isError && s.json?.skill_md?.includes('# Selftest'));
}

const covered = [
  'get_project_context', 'search', 'get_work_item', 'create_work_item', 'update_work_item',
  'read_attachment', 'upload_attachment', 'append_note', 'get_skill',
];
const missing = toolNames.filter((t) => !covered.includes(t));
check('9 个工具 100% 覆盖且无多余工具', missing.length === 0 && toolNames.length === 9);

await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
await prisma.project.delete({ where: { id: otherProj.id } }).catch(() => {});
await prisma.note.deleteMany({ where: { tags: { has: 'selftest' } } });
await prisma.$disconnect();
rmSync(path.join(SERVER_DIR, 'test-data'), { recursive: true, force: true });
ac.abort();
console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
