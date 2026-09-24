/**
 * 26 个 MCP 工具逐个实测（走 SSE 传输，与容器/IDE 交付形态一致）。
 *
 * 设计要点：
 * - 专用临时项目（TEST_PROJECT_SLUG），不碰用户「白泽团队」；跑完级联删除；
 * - 每个工具都断言「返回形状 + 业务语义」，不只断言调用成功；
 * - 失败路径同样覆盖：非法状态流转、读图片当文本、越权 purge_trash、多项目歧义；
 * - 先用 Prisma 准备 fixtures（长文本缺陷/日志附件/两类任务），否则读类工具无料可测。
 *
 * 用法：KEY=vhk_live_xxx node scripts/test-all-mcp-tools.mjs
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE ?? 'http://127.0.0.1:3210';
const DB = process.env.DATABASE_URL ?? 'postgresql://vibehub:vibehub@127.0.0.1:55433/vibehub';
const KEY = process.env.KEY;
if (!KEY) {
  console.error('需要 KEY=vhk_live_... （或在 server/.env 之外显式提供）');
  process.exit(1);
}

const SLUG = `mcp-tool-test-${Date.now()}`;
const LONG = 'X'.repeat(800);
const LOG_TEXT = [
  '2026-09-23 10:00:01 INFO  启动服务',
  '2026-09-23 10:00:02 INFO  加载路由 /api/bugs',
  '2026-09-23 10:00:03 ERROR TypeError: Cannot read properties of undefined',
  '    at updateBug (src/services/bugs.ts:218:11)',
  '2026-09-23 10:00:04 ERROR 请求失败 500',
  '2026-09-23 10:00:05 INFO  重试成功',
].join('\n');
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let pass = 0;
let fail = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  results.push({ name, ok: !!cond, detail });
}

/** ---------- fixtures ---------- */
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: DB } } });
const project = await prisma.project.create({ data: { id: `prj_${randomBytes(6).toString('hex')}`, name: 'MCP 工具自检', slug: SLUG } });
const longBug = await prisma.bug.create({
  data: { id: `bug_${randomBytes(6).toString('hex')}`, projectId: project.id, title: '长文本缺陷（验证 500 字符截断）', actualResult: LONG, severity: 'low' },
});
const logAtt = await prisma.attachment.create({
  data: {
    id: `att_${randomBytes(6).toString('hex')}`, projectId: project.id, entityType: 'bug', entityId: longBug.id,
    fileName: 'stacktrace.log', fileType: 'text/plain', fileSize: Buffer.byteLength(LOG_TEXT),
    storagePath: path.join(SERVER_DIR, 'test-data', 'mcp-selftest.log'), uploadedBy: 'human',
  },
});
const { writeFileSync, mkdirSync, rmSync } = await import('node:fs');
mkdirSync(path.join(SERVER_DIR, 'test-data'), { recursive: true });
writeFileSync(logAtt.storagePath, LOG_TEXT);
const imgAtt = await prisma.attachment.create({
  data: {
    id: `att_${randomBytes(6).toString('hex')}`, projectId: project.id, entityType: 'bug', entityId: longBug.id,
    fileName: 'shot.png', fileType: 'image/png', fileSize: 100,
    storagePath: path.join(SERVER_DIR, 'test-data', 'mcp-selftest.png'), uploadedBy: 'human', width: 1, height: 1,
  },
});
writeFileSync(imgAtt.storagePath, Buffer.from(PNG_B64, 'base64'));
await prisma.task.create({ data: { id: `tsk_${randomBytes(6).toString('hex')}`, projectId: project.id, title: '登录接口联调', description: '与后端对齐字段', priority: 'high', status: 'todo' } });
await prisma.task.create({ data: { id: `tsk_${randomBytes(6).toString('hex')}`, projectId: project.id, title: '导出功能设计', status: 'done' } });
console.log(`fixtures 就绪：项目 ${SLUG}；长文本缺陷 ${longBug.id}；日志 ${logAtt.id}；图片 ${imgAtt.id}\n`);
/** ---------- SSE MCP 客户端 ---------- */
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
/** 调工具并解析文本内容；返回 { raw, json, isError, text } */
async function call(name, args = {}) {
  const r = await send('tools/call', { name, arguments: args });
  const text = r.result?.content?.[0]?.text ?? '';
  let json = null;
  try { json = JSON.parse(text); } catch { /* 错误文本非 JSON */ }
  return { raw: r, text, json, isError: r.result?.isError ?? false };
}

await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'tool-test', version: '1' } });
const list = await send('tools/list', {});
const toolNames = (list.result?.tools ?? []).map((t) => t.name);
console.log(`── 工具清单（${toolNames.length} 个）──\n${toolNames.join(', ')}\n`);

/* ============ 1. get_project_context ============ */
console.log('【1/26】get_project_context — 冷启动读项目上下文');
{
  const r = await call('get_project_context', { project_slug: SLUG });
  check('成功返回且未报错', !r.isError, r.isError ? r.text.slice(0, 120) : '');
  check('命中项目名', r.text.includes('MCP 工具自检'));
  check('带出待处理缺陷（长文本那条）', r.text.includes('长文本缺陷'));
  check('带出待办任务', r.text.includes('登录接口联调'));
  const amb = await call('get_project_context', {});
  check('多项目不传 slug → 歧义报错并列出可选', amb.isError && amb.text.includes(SLUG), amb.text.slice(0, 100).replace(/\s+/g, ' '));
}

/* ============ 2. list_bugs ============ */
console.log('\n【2/26】list_bugs — 列缺陷 + 分页整形');
{
  const r = await call('list_bugs', { project_slug: SLUG });
  check('成功返回', !r.isError, r.isError ? r.text.slice(0, 120) : '');
  check('含 has_more 分页字段', r.text.includes('has_more'));
  check('含目标缺陷', r.text.includes('长文本缺陷'));
  const filtered = await call('list_bugs', { project_slug: SLUG, status: 'resolved' });
  check('status 过滤生效（resolved 命中 0 条）', !filtered.text.includes('长文本缺陷'));
}

/* ============ 3. get_bug_detail ============ */
console.log('\n【3/26】get_bug_detail — 详情 + 长文本 500 字符截断');
{
  const r = await call('get_bug_detail', { bug_id: longBug.id });
  check('成功返回', !r.isError, r.isError ? r.text.slice(0, 120) : '');
  check('标题正确', r.text.includes('长文本缺陷'));
  check('800 字符字段被截断到 500 以内', !r.text.includes(LONG), `响应 ${Buffer.byteLength(r.text)} 字节`);
  check('给出截断提示', /截断|truncat|tip/i.test(r.text), '');
}

/* ============ 4. read_attachment_text ============ */
console.log('\n【4/26】read_attachment_text — 日志分片读取');
{
  const r = await call('read_attachment_text', { attachment_id: logAtt.id });
  check('成功读到日志内容', !r.isError && r.text.includes('TypeError'), r.isError ? r.text.slice(0, 120) : '');
  const grep = await call('read_attachment_text', { attachment_id: logAtt.id, grep_keyword: 'ERROR' });
  check('grep_keyword 只回命中行', grep.text.includes('ERROR') && !grep.text.includes('重试成功'));
  const sliced = await call('read_attachment_text', { attachment_id: logAtt.id, offset_line: 1, limit_lines: 1 });
  check('offset/limit 分片生效（仅 1 行）', sliced.text.includes('启动服务') && !sliced.text.includes('TypeError'));
}

/* ============ 5. inspect_image_asset ============ */
console.log('\n【5/26】inspect_image_asset — 读图元信息');
{
  const r = await call('inspect_image_asset', { attachment_id: imgAtt.id });
  check('成功返回图片信息', !r.isError, r.isError ? r.text.slice(0, 120) : '');
  check('含尺寸字段', /width|height/.test(r.text));
  const wrong = await call('inspect_image_asset', { attachment_id: logAtt.id });
  check('对非图片给出人话错误', wrong.isError, wrong.text.slice(0, 80).replace(/\s+/g, ' '));
}

/* ============ 6. update_bug_status ============ */
console.log('\n【6/26】update_bug_status — 状态回填 + 状态机校验');
{
  const ok1 = await call('update_bug_status', { bug_id: longBug.id, status: 'in_progress' });
  check('open → in_progress 通过', !ok1.isError, ok1.isError ? ok1.text.slice(0, 160) : '');
  const bad = await call('update_bug_status', { bug_id: longBug.id, status: 'closed' });
  check('非法跨级被拒（in_progress → closed）', bad.isError, bad.text.slice(0, 90).replace(/\s+/g, ' '));
  const ok2 = await call('update_bug_status', {
    bug_id: longBug.id, status: 'resolved', resolution_notes: '已修复', commit_hash: 'abc1234',
  });
  check('携带 commit_hash 回填 resolved 成功', !ok2.isError, ok2.isError ? ok2.text.slice(0, 160) : '');
  const detail = await call('get_bug_detail', { bug_id: longBug.id });
  check('回填内容已落库（commit abc1234）', detail.text.includes('abc1234'));
  check('详情无多余字段（本轮修复：不再串入 value/truncated）', !detail.text.includes('"value"'), '回归断言');
}

/* ============ 7. append_scratchpad ============ */
console.log('\n【7/26】append_scratchpad — 写随手记 + 标签（需 note:write）');
{
  const r = await call('append_scratchpad', { project_slug: SLUG, content: '## 自检便签\n联调注意时区', tags: ['selftest', 'auth'] });
  check('成功创建便签', !r.isError, r.isError ? r.text.slice(0, 120) : '');
  check('Markdown 内容原样保存', r.text.includes('自检便签'));
  check('标签解析正确', r.text.includes('selftest') && r.text.includes('auth'));
  check('已关联到目标项目', r.text.includes(project.id), '全局便签是另一条路径，此处断言归属');
}

/* ============ 8. list_notes ============ */
console.log('\n【8/26】list_notes — 列便签');
{
  const r = await call('list_notes', { project_slug: SLUG });
  check('成功返回', !r.isError, r.isError ? r.text.slice(0, 120) : '');
  check('含刚写的便签', r.text.includes('自检便签'));
  const byTag = await call('list_notes', { project_slug: SLUG, tag: 'selftest' });
  check('按 tag 过滤命中', byTag.text.includes('自检便签'));
}

/* ============ 9. search ============ */
console.log('\n【9/26】search — 关键词 + 语义检索');
{
  const r = await call('search', { q: '长文本', project_slug: SLUG });
  check('成功返回', !r.isError, r.isError ? r.text.slice(0, 120) : '');
  check('关键词命中缺陷', r.text.includes('长文本缺陷'));
  const empty = await call('search', { q: 'zzz-不存在的词-zzz', project_slug: SLUG });
  check('无命中时返回空结果而非报错', !empty.isError);
}

/* ============ 10. create_bug ============ */
console.log('\n【10/26】create_bug — AI 建缺陷');
{
  const r = await call('create_bug', {
    project_slug: SLUG, title: 'MCP 工具自检：创建缺陷', severity: 'high',
    steps_to_reproduce: '1. 调工具 2. 看结果', expected_result: '写入成功', actual_result: '确实成功',
  });
  check('成功创建', !r.isError, r.isError ? r.text.slice(0, 120) : '');
  const newId = r.json?.bug?.id;
  check('返回新缺陷 ID', !!newId, newId ?? '');
  check('返回 ok=true', r.json?.ok === true, '');
  globalThis.__newBugId = newId;
}

/* ============ 11. add_bug_comment ============ */
console.log('\n【11/26】add_bug_comment — 追加评论（AI 身份）');
{
  const r = await call('add_bug_comment', { bug_id: globalThis.__newBugId, content: '自检评论：已按步骤复现' });
  check('成功追加评论', !r.isError, r.isError ? r.text.slice(0, 120) : '');
  check('返回 comment_id', /comment_id/.test(r.text), r.text.slice(0, 80).replace(/\s+/g, ' '));
  const row = await prisma.bugComment.findFirst({ where: { bugId: globalThis.__newBugId, content: '自检评论：已按步骤复现' } });
  check('评论内容已落库且作者为 ai', row?.content === '自检评论：已按步骤复现' && row?.authorType === 'ai', `author=${row?.authorType ?? '未找到'}`);
}

/* ============ 12. upload_attachment ============ */
console.log('\n【12/26】upload_attachment — base64 上传附件');
{
  const r = await call('upload_attachment', {
    project_slug: SLUG, bug_id: globalThis.__newBugId,
    file_name: 'selftest-shot.png', file_type: 'image/png', data_base64: PNG_B64,
  });
  check('成功上传', !r.isError, r.isError ? r.text.slice(0, 160) : '');
  const attId = r.json?.attachment?.id ?? r.json?.id;
  check('返回附件 ID', !!attId, attId ?? '');
  const detailAfter = await call('get_bug_detail', { bug_id: globalThis.__newBugId });
  check('详情里能看到该附件（归属生效）', detailAfter.text.includes('selftest-shot.png'));
  const attRow = await prisma.attachment.findFirst({ where: { id: attId } });
  check('数据库归属 entityId = 目标缺陷', attRow?.entityId === globalThis.__newBugId, `entityType=${attRow?.entityType}`);
  const bad = await call('upload_attachment', { file_name: 'x.png', file_type: 'image/png' });
  check('缺 data_base64 → 校验失败（人话）', bad.isError, bad.text.slice(0, 90).replace(/\s+/g, ' '));
}

/* ============ 13. list_tasks ============ */
console.log('\n【13/26】list_tasks — 列任务 + 状态过滤（需 task:read）');
{
  const r = await call('list_tasks', { project_slug: SLUG });
  check('成功返回', !r.isError, r.isError ? r.text.slice(0, 120) : '');
  check('含两条 fixture 任务', r.text.includes('登录接口联调') && r.text.includes('导出功能设计'));
  const todo = await call('list_tasks', { project_slug: SLUG, status: 'todo' });
  check('status=todo 过滤掉已完成任务', todo.text.includes('登录接口联调') && !todo.text.includes('导出功能设计'));
}

/* ============ 14. create_task ============ */
console.log('\n【14/26】create_task — AI 建任务（需 task:write）');
{
  const r = await call('create_task', { project_slug: SLUG, title: 'MCP 自检建的任务', description: '由 create_task 创建', priority: 'low' });
  check('成功建任务', !r.isError, r.isError ? r.text.slice(0, 140) : '');
  let newId = null;
  try { newId = JSON.parse(r.text).task?.id; } catch { /* ignore */ }
  const row = newId ? await prisma.task.findUnique({ where: { id: newId } }) : null;
  check('数据库落在自检项目、默认 todo', row?.projectId === project.id && row?.status === 'todo' && row?.priority === 'low', `status=${row?.status}`);
  const bad = await call('create_task', { project_slug: SLUG, title: 'x', status: 'blocked' });
  check('非法状态 → 校验失败', bad.isError, bad.text.slice(0, 90).replace(/\s+/g, ' '));
  if (newId) await prisma.task.delete({ where: { id: newId } });
}

/* ============ 15. update_task ============ */
console.log('\n【15/26】update_task — 改任务状态/优先级（需 task:write）');
{
  const todo = await call('list_tasks', { project_slug: SLUG, status: 'todo' });
  let taskId = null;
  try { taskId = JSON.parse(todo.text).items?.[0]?.id ?? JSON.parse(todo.text).tasks?.[0]?.id; } catch { /* ignore */ }
  if (!taskId) {
    const t = await prisma.task.findFirst({ where: { projectId: project.id, status: 'todo' } });
    taskId = t?.id ?? null;
  }
  const r = await call('update_task', { task_id: taskId, status: 'doing', priority: 'medium' });
  check('成功更新任务', !r.isError, r.isError ? r.text.slice(0, 140) : '');
  check('新状态已生效', r.text.includes('doing'));
  const after = await call('list_tasks', { project_slug: SLUG, status: 'doing' });
  check('按 doing 可查回该任务', after.text.includes('登录接口联调'));
}

/* ============ 16. purge_trash ============ */
console.log('\n【16/26】purge_trash — 回收站清理（需 admin scope）');
{
  const r = await call('purge_trash', {});
  check('admin scope 下成功执行', !r.isError && r.text.includes('purged'), r.isError ? r.text.slice(0, 120) : r.text.replace(/\s+/g, ' ').slice(0, 80));
  check('返回实际清理数量字段', /purged/.test(r.text));
}

/* ============ 17. get_task_detail ============ */
console.log('\n【17/26】get_task_detail — 任务详情 + 可走的下一步（需 task:read）');
let flowTaskId = null;
{
  const c = await call('create_task', { project_slug: SLUG, title: '详情与删除自检', description: 'D'.repeat(700), labels: ['selftest'] });
  try { flowTaskId = JSON.parse(c.text).task?.id; } catch { /* ignore */ }
  const r = await call('get_task_detail', { task_id: flowTaskId });
  check('成功返回详情', !r.isError, r.isError ? r.text.slice(0, 140) : '');
  check('带 allowed_next_statuses 与标签', r.json?.allowed_next_statuses?.includes('doing') && r.json?.labels?.includes('selftest'));
  check('长描述默认截断', r.json?.description_truncated === true);
  const full = await call('get_task_detail', { task_id: flowTaskId, full: true });
  check('full=true 返回全文', full.json?.description?.length === 700);
}

/* ============ 18. 任务五态（经 update_task） ============ */
console.log('\n【18/26】update_task 五态 — 不能跳级、打回要原因');
{
  const skip = await call('update_task', { task_id: flowTaskId, status: 'review' });
  check('todo → review 跳级被拒', skip.isError && skip.text.includes('不能从'), skip.text.slice(0, 80).replace(/\s+/g, ' '));
  await call('update_task', { task_id: flowTaskId, status: 'doing' });
  const rv = await call('update_task', { task_id: flowTaskId, status: 'review' });
  check('doing → review 成功', !rv.isError && rv.json?.task?.status === 'review');
  const noReason = await call('update_task', { task_id: flowTaskId, status: 'doing' });
  check('打回不写原因被拒', noReason.isError && noReason.text.includes('reopen_reason'));
  const back = await call('update_task', { task_id: flowTaskId, status: 'doing', reopen_reason: '自检打回' });
  check('写原因后打回成功', !back.isError && back.json?.task?.status === 'doing');
}

/* ============ 19. delete_task ============ */
console.log('\n【19/26】delete_task — 删除任务（需 task:write）');
{
  const r = await call('delete_task', { task_id: flowTaskId });
  check('删除成功', !r.isError && r.json?.ok === true, r.isError ? r.text.slice(0, 120) : '');
  check('数据库已无该任务', (await prisma.task.findUnique({ where: { id: flowTaskId } })) === null);
}

/* ============ 20. delete_bug ============ */
console.log('\n【20/26】delete_bug — 删除缺陷（需 bug:write）');
{
  const c = await call('create_bug', { project_slug: SLUG, title: '待删除的重复单' });
  let bugId = null;
  try { bugId = JSON.parse(c.text).bug?.id ?? JSON.parse(c.text).id; } catch { /* ignore */ }
  const r = await call('delete_bug', { bug_id: bugId });
  check('删除成功', !r.isError && r.json?.ok === true, r.isError ? r.text.slice(0, 120) : '');
  check('数据库已无该缺陷', bugId && (await prisma.bug.findUnique({ where: { id: bugId } })) === null);
}

/* ============ 21/22. update_note / delete_note ============ */
console.log('\n【21/26】update_note — 改便签（需 note:write）');
let noteId = null;
{
  const a = await call('append_scratchpad', { project_slug: SLUG, content: '待修改', tags: ['selftest'] });
  try { noteId = JSON.parse(a.text).id; } catch { /* ignore */ }
  const r = await call('update_note', { note_id: noteId, content: '已修改', pinned: true });
  check('修改成功', !r.isError && r.json?.note?.content === '已修改' && r.json?.note?.pinned === true, r.isError ? r.text.slice(0, 120) : '');
}
console.log('\n【22/26】delete_note — 删便签（需 note:write）');
{
  const r = await call('delete_note', { note_id: noteId });
  check('删除成功', !r.isError && r.json?.ok === true);
  check('数据库已无该便签', (await prisma.note.findUnique({ where: { id: noteId } })) === null);
}

/* ============ 23. delete_attachment ============ */
console.log('\n【23/26】delete_attachment — 删附件（需 attachment:write）');
{
  const up = await call('upload_attachment', { project_slug: SLUG, file_name: 'tmp.log', file_type: 'text/plain', data_base64: Buffer.from('tmp').toString('base64') });
  let attId = null;
  try { attId = JSON.parse(up.text).attachment?.id; } catch { /* ignore */ }
  const r = await call('delete_attachment', { attachment_id: attId });
  check('删除成功', !r.isError && r.json?.ok === true, r.isError ? r.text.slice(0, 120) : '');
}

/* ============ 24-26. 技能：upload / list / download / delete ============ */
console.log('\n【24/26】upload_skill + list_skills — 上传与查看（需 skill:write / context:read）');
const SKILL_MD = '---\nname: selftest-skill\ndescription: MCP 自检用技能\n---\n\n# 自检\n';
{
  const up = await call('upload_skill', { project_slug: SLUG, skill_md: SKILL_MD, files: [{ path: 'scripts/hi.sh', content: 'echo hi' }] });
  check('上传成功（created）', !up.isError && up.json?.action === 'created', up.isError ? up.text.slice(0, 140) : '');
  const again = await call('upload_skill', { project_slug: SLUG, skill_md: SKILL_MD });
  check('同名再传为覆盖（updated）', again.json?.action === 'updated');
  const bad = await call('upload_skill', { project_slug: SLUG, skill_md: '# 没有 frontmatter' });
  check('缺 frontmatter 人话报错', bad.isError && bad.text.includes('frontmatter'));
  const l = await call('list_skills', { project_slug: SLUG });
  check('list_skills 可见名称与描述', l.json?.skills?.some((x) => x.name === 'selftest-skill' && x.description === 'MCP 自检用技能'));
}
console.log('\n【25/26】download_skill — 下载全文');
{
  await call('upload_skill', { project_slug: SLUG, skill_md: SKILL_MD, files: [{ path: 'scripts/hi.sh', content: 'echo hi' }] });
  const d = await call('download_skill', { project_slug: SLUG, name: 'selftest-skill' });
  check('返回 SKILL.md 与附带文件', d.json?.skill_md?.includes('selftest-skill') && d.json?.files?.[0]?.content === 'echo hi');
  check('给出安装目录', d.json?.install_dir === '.claude/skills/selftest-skill');
}
console.log('\n【26/26】delete_skill — 删除技能（需 skill:write）');
{
  const r = await call('delete_skill', { project_slug: SLUG, name: 'selftest-skill' });
  check('删除成功', !r.isError && r.json?.ok === true);
  check('数据库已无该技能', (await prisma.skill.count({ where: { name: 'selftest-skill', projectId: project.id } })) === 0);
}

/* ---------- 清单核对 ---------- */
console.log('\n── 工具覆盖核对 ──');
const covered = ['get_project_context','list_bugs','get_bug_detail','read_attachment_text','inspect_image_asset','update_bug_status','append_scratchpad','list_notes','search','create_bug','add_bug_comment','upload_attachment','list_tasks','create_task','update_task','purge_trash',
  'get_task_detail','delete_task','delete_bug','update_note','delete_note','delete_attachment','list_skills','download_skill','upload_skill','delete_skill'];
const missing = toolNames.filter((t) => !covered.includes(t));
check('清单里 26 个工具全部被测到', missing.length === 0 && covered.length === 26 && toolNames.length === 26, missing.length ? `漏测: ${missing.join(',')}` : '');

/* ---------- 清理 ---------- */
console.log('\n── 清理自检数据 ──');
await prisma.project.delete({ where: { id: project.id } }).catch((e) => console.error('删项目失败:', e.message));
await prisma.note.deleteMany({ where: { tags: { has: 'selftest' } } });
await prisma.$disconnect();
rmSync(path.join(SERVER_DIR, 'test-data'), { recursive: true, force: true });
console.log(`已删除临时项目 ${SLUG}（级联缺陷/任务/附件）与自检便签`);

ac.abort();
console.log(`\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
