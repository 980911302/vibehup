import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, it, expect, beforeEach } from 'vitest';
import sharp from 'sharp';
import { prisma } from '../core/prisma.js';
import { resetDb, createApiKey } from '../test-helpers.js';
import * as projectsService from '../services/projects.js';
import * as bugsService from '../services/bugs.js';
import * as tasksService from '../services/tasks.js';
import * as attachmentsService from '../services/attachments.js';
import { storage } from '../services/storage.js';
import { randomIdAttachment } from '../core/ids.js';
import * as mcpTools from './tools.js';
import * as workTools from './tools-work.js';
import * as fileTools from './tools-files.js';
import { createMcpServer, TOOL_NAMES } from './server.js';
import { resolveMcpContext, loadKeyedContext, McpContextError, type McpContext } from './context.js';
import { hasScope } from './scopes.js';
import { recordToolCall } from './usage.js';
import { paginate, truncateText, enforceSizeBudget } from './token-budget.js';

const localAdmin: McpContext = { mode: 'local', apiKeyId: null, scopes: new Set(['admin']), actorLabel: 'local' };

beforeEach(async () => {
  await resetDb();
  await fs.rm(path.join(storage.rootDir), { recursive: true, force: true });
});

describe('工具矩阵（R96 精简为 9 个核心工具）', () => {
  it('TOOL_NAMES = 9 个且与注册一致', () => {
    expect(TOOL_NAMES).toHaveLength(9);
    const expected = [
      'get_project_context',
      'search',
      'get_work_item',
      'create_work_item',
      'update_work_item',
      'read_attachment',
      'upload_attachment',
      'append_note',
      'get_skill',
    ].sort();
    expect([...TOOL_NAMES].sort()).toEqual(expected);
    expect(createMcpServer()).toBeDefined();
  });
});

describe('MCP 四模块', () => {
  it('token-budget：paginate / truncate / 64KB', () => {
    const p = paginate(Array.from({ length: 45 }, (_, i) => i));
    expect(p.returned).toBe(20);
    expect(p.has_more).toBe(true);
    expect(p.next_cursor).toBe(20);
    expect(paginate([1, 2, 3]).has_more).toBe(false);

    const t = truncateText('a'.repeat(600));
    expect(t.truncated).toBe(true);
    expect(t.value).toContain('已截断');
    expect(truncateText(null).value).toBeNull();

    const big = { items: Array.from({ length: 500 }, (_, i) => ({ i, pad: 'x'.repeat(200) })) };
    const e = enforceSizeBudget(big);
    expect(e.items!.length).toBeLessThan(500);
    expect(e.warning).toBeTruthy();
  });

  it('scopes：精确/拒绝/admin 通配', () => {
    expect(hasScope(new Set(['context:read']), 'context:read')).toBe(true);
    expect(hasScope(new Set(['context:read']), 'bug:write')).toBe(false);
    expect(hasScope(new Set(['admin']), 'bug:write')).toBe(true);
  });

  it('context：local 全权 / keyed 解析 / 无效密钥抛错', async () => {
    const local = await resolveMcpContext({} as NodeJS.ProcessEnv);
    expect(local.mode).toBe('local');
    expect(local.scopes.has('admin')).toBe(true);

    const key = await createApiKey({ scopes: ['context:read', 'bug:write'] });
    const ctx = await loadKeyedContext(key.key);
    expect(ctx.mode).toBe('keyed');
    expect(ctx.apiKeyId).toBe(key.id);
    expect(ctx.actorLabel.startsWith('test-key(')).toBe(true);

    await expect(loadKeyedContext('vhk_test_wrong')).rejects.toThrow(McpContextError);
    await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    await expect(loadKeyedContext(key.key)).rejects.toThrow('撤销');
  });

  it('usage：recordToolCall 落账 + lastUsedAt', async () => {
    const key = await createApiKey({ name: 'usage-key' });
    const ctx = await loadKeyedContext(key.key);
    await recordToolCall(ctx, { tool: 'search', latencyMs: 5, bytesOut: 100, result: 'ok' });
    expect(await prisma.usageEvent.count({ where: { apiKeyId: key.id } })).toBe(1);
    const refreshed = await prisma.apiKey.findUnique({ where: { id: key.id } });
    expect(refreshed?.lastUsedAt).not.toBeNull();
  });
});

describe('MCP 工具行为', () => {
  it('空库 get_project_context 人话错误不崩', async () => {
    await expect(mcpTools.getProjectContext(localAdmin, {})).rejects.toThrow('项目');
  });

  it('create_work_item(bug) 落 ai 活动流；update_work_item(comment) 可追问', async () => {
    await projectsService.createProject({ name: 'MCP', slug: 'mcp' });
    const ctx: McpContext = { mode: 'keyed', apiKeyId: 'key_1', scopes: new Set(['bug:write']), actorLabel: 'k(vhk)' };
    const created = await workTools.createWorkItem(ctx, { type: 'bug', project_slug: 'mcp', title: 'AI 建单' });
    expect(created.ok).toBe(true);
    const bugId = created.bug!.id;
    const comments = await prisma.bugComment.findMany({ where: { bugId } });
    expect(comments).toHaveLength(1);
    expect(comments[0].authorType).toBe('ai');
    expect(comments[0].authorId).toBe('key_1');

    await workTools.updateWorkItem(ctx, { id: bugId, comment: '已定位 NPE' });
    expect(await prisma.bugComment.count({ where: { bugId } })).toBe(2);
  });

  it('upload_attachment：base64 入 → uploadedBy=密钥 ID', async () => {
    await projectsService.createProject({ name: 'U', slug: 'up' });
    const ctx: McpContext = { mode: 'keyed', apiKeyId: 'key_up', scopes: new Set(['attachment:write']), actorLabel: 'k(vhk)' };
    const r = await fileTools.uploadAttachment(ctx, {
      project_slug: 'up',
      file_name: 'trace.log',
      file_type: 'text/plain',
      data_base64: Buffer.from('stack trace').toString('base64'),
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('direct');
    const att = await prisma.attachment.findUnique({ where: { id: r.attachment!.id } });
    expect(att?.uploadedBy).toBe('key_up');
  });

  it('update_work_item 带 ai actor 写评论流，状态机严格禁止跳级且回流必填 reopen_reason', async () => {
    const p = await projectsService.createProject({ name: 'F', slug: 'flow' });
    const bug = await bugsService.createBug({ projectId: p.id, title: '流转' });
    const ctx: McpContext = { mode: 'keyed', apiKeyId: 'key_f', scopes: new Set(['context:read', 'bug:write']), actorLabel: 'k(vhk)' };

    expect((await workTools.getWorkItem(ctx, { id: bug.id })).allowed_next_statuses).toEqual(['in_progress', 'closed']);
    await expect(workTools.updateWorkItem(ctx, { id: bug.id, status: 'resolved' })).rejects.toThrow('不能从「待处理」直接改为「已解决」');

    const s1 = await workTools.updateWorkItem(ctx, { id: bug.id, status: 'in_progress', commit_hash: 'cafe1' });
    expect(s1.next_step).toContain('resolved');
    const s2 = await workTools.updateWorkItem(ctx, { id: bug.id, status: 'resolved', resolution_notes: '根因 X，改了 Y，单测覆盖' });
    expect(s2.allowed_next_statuses).toContain('verifying');
    expect(s2.allowed_next_statuses).not.toContain('verified');

    await expect(workTools.updateWorkItem(ctx, { id: bug.id, status: 'open' })).rejects.toThrow('reopen_reason');
    const back = await workTools.updateWorkItem(ctx, { id: bug.id, status: 'open', reopen_reason: '159 上仍复现' });
    expect(back.bug?.status).toBe('open');
    const comments = await prisma.bugComment.findMany({ where: { bugId: bug.id } });
    expect(comments.some((c) => c.content.includes('cafe1'))).toBe(true);
    expect(comments.some((c) => c.content.includes('159 上仍复现'))).toBe(true);
  });

  it('get_project_context 摆出待验证缺陷、doing 任务和流转提醒', async () => {
    const p = await projectsService.createProject({ name: 'C', slug: 'ctx' });
    const fixing = await bugsService.createBug({ projectId: p.id, title: '修复中' });
    await workTools.updateWorkItem(localAdmin, { id: fixing.id, status: 'in_progress' });
    const fixed = await bugsService.createBug({ projectId: p.id, title: '已修待验' });
    await workTools.updateWorkItem(localAdmin, { id: fixed.id, status: 'in_progress' });
    await workTools.updateWorkItem(localAdmin, { id: fixed.id, status: 'resolved', resolution_notes: 'ok' });
    await tasksService.createTask({ projectId: p.id, title: '做到一半', status: 'doing' });
    await tasksService.createTask({ projectId: p.id, title: '还没开始' });

    const c = await mcpTools.getProjectContext(localAdmin, { project_slug: 'ctx' });
    expect(c.summary).toMatchObject({ open_bugs: 1, awaiting_verification: 1, todo_tasks: 1, doing_tasks: 1 });
    expect(c.awaiting_verification.map((b) => b.title)).toEqual(['已修待验']);
    expect(c.doing_tasks.map((t) => t.title)).toEqual(['做到一半']);
    expect(c.reminders.join('\n')).toMatch(/in_progress[\s\S]*待验证[\s\S]*doing/);
  });

  it('append_note 无项目时建全局便签并解析标签', async () => {
    const note = await mcpTools.appendNote(localAdmin, { content: '想法', tags: ['idea'] });
    expect(note.tags).toEqual(['idea']);
    expect(note.project_id).toBeNull();
  });

  it('search(type="bug") 默认分页 20 条；get_work_item 长字段截断', async () => {
    const p = await projectsService.createProject({ name: 'L', slug: 'lst' });
    for (let i = 0; i < 25; i++) await bugsService.createBug({ projectId: p.id, title: `B${i}`, actualResult: i === 0 ? 'x'.repeat(800) : undefined });
    const r = await mcpTools.search(localAdmin, { project_slug: 'lst', type: 'bug' });
    expect(r.mode).toBe('list');
    expect(r.bugs?.returned).toBe(20);
    expect(r.bugs?.total).toBe(25);
    expect(r.bugs?.has_more).toBe(true);

    const first = (await prisma.bug.findFirstOrThrow({ where: { title: 'B0' } }));
    const d = await workTools.getWorkItem(localAdmin, { id: first.id });
    expect((d as { actual_result_truncated?: boolean }).actual_result_truncated).toBe(true);
    expect((d as { tip?: string }).tip).toContain('read_attachment');
  });

  it('read_attachment 统一处理文本分片/grep 与图片降采样', async () => {
    const p = await projectsService.createProject({ name: 'R', slug: 'rd' });
    const stored = await storage.writeBuffer(Buffer.from('ok line\nERROR boom'), randomIdAttachment(), 'log');
    const att = await attachmentsService.createAttachment({
      projectId: p.id, entityType: 'general', fileName: 'a.log', fileType: 'text/plain', fileSize: 15, storagePath: stored.storagePath,
    });
    const slice = (await fileTools.readAttachment(localAdmin, { attachment_id: att.id, grep_keyword: 'ERROR' })) as Record<string, unknown>;
    expect(slice.total_lines).toBe(1);
    expect(slice.content).toContain('L2: ERROR boom');

    const png = await storage.writeBuffer(
      await sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer(),
      randomIdAttachment(), 'png',
    );
    const imgAtt = await attachmentsService.createAttachment({
      projectId: p.id, entityType: 'general', fileName: 'big.png', fileType: 'image/png', fileSize: 100, storagePath: png.storagePath,
    });
    const pathMode = (await fileTools.readAttachment(localAdmin, { attachment_id: imgAtt.id, return_mode: 'path' })) as Record<string, unknown>;
    expect(pathMode.downscaled).toBe(true);
    expect(pathMode.width).toBe(1080);
  });

  it('create_work_item(task) 与 update_work_item(task)：缺省值 / 关联附件 / 多项目校验 / 修改标题描述', async () => {
    const p = await projectsService.createProject({ name: '任务项目', slug: 'tsk' });
    await projectsService.createProject({ name: '另一个项目', slug: 'other' });

    const a = await workTools.createWorkItem(localAdmin, { type: 'task', project_slug: 'tsk', title: '  补验收用例  ', description: '详情 **md**' });
    expect(a.task).toMatchObject({ title: '补验收用例', status: 'todo', priority: 'medium', project_slug: 'tsk' });

    const att = await attachmentsService.createAttachment({
      projectId: p.id, entityType: 'general', fileName: 'log.txt', fileType: 'text/plain', fileSize: 1, storagePath: 'x/log.txt',
    });
    const b = await workTools.createWorkItem(localAdmin, {
      type: 'task', project_slug: 'tsk', title: '已在做', priority: 'high', status: 'doing', attachment_ids: [att.id],
    });
    expect(b.task).toMatchObject({ status: 'doing', priority: 'high' });
    expect(b.next_step).toContain('review');
    expect(await prisma.attachment.findUnique({ where: { id: att.id } })).toMatchObject({ entityType: 'task', entityId: b.task!.id });

    await expect(workTools.createWorkItem(localAdmin, { type: 'task', title: 'x' })).rejects.toThrow('project_slug');
    await expect(workTools.createWorkItem(localAdmin, { type: 'task', project_slug: 'tsk', title: '   ' })).rejects.toThrow('title');
    await expect(workTools.createWorkItem(localAdmin, { type: 'task', project_slug: 'tsk', title: 'x', status: 'blocked' })).rejects.toThrow('status');

    const listed = await mcpTools.search(localAdmin, { project_slug: 'tsk', type: 'task', status: 'todo' });
    expect(listed.tasks?.items).toHaveLength(1);
    expect(listed.tasks?.items[0].description).toBe('详情 **md**');

    const u = await workTools.updateWorkItem(localAdmin, { id: a.task!.id, title: '改后标题', description: '新描述', status: 'doing' });
    expect(u.task).toMatchObject({ title: '改后标题', status: 'doing' });
    await expect(workTools.updateWorkItem(localAdmin, { id: a.task!.id, title: ' ' })).rejects.toThrow('title');
  });
});
