import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb, createApiKey, createUser } from '../test-helpers.js';
import * as projectsService from '../services/projects.js';
import * as bugsService from '../services/bugs.js';
import * as tasksService from '../services/tasks.js';
import * as attachmentsService from '../services/attachments.js';
import { storage } from '../services/storage.js';
import { randomIdAttachment } from '../core/ids.js';
import * as mcpTools from './tools.js';
import * as ext from './tools-extended.js';
import { createMcpServer, TOOL_NAMES } from './server.js';
import { resolveMcpContext, loadKeyedContext, McpContextError } from './context.js';
import { hasScope } from './scopes.js';
import { recordToolCall } from './usage.js';
import { paginate, truncateText, enforceSizeBudget } from './token-budget.js';
import sharp from 'sharp';

/** MCP 单测：26 工具矩阵 + ctx/scopes/usage/token-budget 四模块（步骤 05） */

beforeEach(async () => {
  await resetDb();
  await fs.rm(path.join(storage.rootDir), { recursive: true, force: true });
});

describe('工具矩阵', () => {
  it('TOOL_NAMES = 26 个且与注册一致', async () => {
    expect(TOOL_NAMES).toHaveLength(26);
    const expected = [
      'get_project_context', 'list_bugs', 'get_bug_detail', 'read_attachment_text',
      'inspect_image_asset', 'update_bug_status', 'append_scratchpad',
      'list_notes', 'search', 'create_bug', 'add_bug_comment',
      'upload_attachment', 'list_tasks', 'create_task', 'update_task', 'purge_trash',
      'get_task_detail', 'delete_task', 'delete_bug', 'update_note', 'delete_note', 'delete_attachment',
      'list_skills', 'download_skill', 'upload_skill', 'delete_skill',
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
    await recordToolCall(ctx, { tool: 'list_bugs', latencyMs: 5, bytesOut: 100, result: 'ok' });
    expect(await prisma.usageEvent.count({ where: { apiKeyId: key.id } })).toBe(1);
    const refreshed = await prisma.apiKey.findUnique({ where: { id: key.id } });
    expect(refreshed?.lastUsedAt).not.toBeNull();
  });
});

describe('MCP 工具行为', () => {
  it('空库 get_project_context 人话错误不崩', async () => {
    await expect(mcpTools.getProjectContext({})).rejects.toThrow('项目');
  });

  it('create_bug 落 ai 活动流；add_bug_comment 可追问', async () => {
    const p = await projectsService.createProject({ name: 'MCP', slug: 'mcp' });
    const ctx = { mode: 'keyed' as const, apiKeyId: 'key_1', scopes: new Set(['bug:write']), actorLabel: 'k(vhk)' };
    const created = await ext.createBug(ctx, { project_slug: 'mcp', title: 'AI 建单' });
    expect(created.ok).toBe(true);
    const comments = await prisma.bugComment.findMany({ where: { bugId: created.bug.id } });
    expect(comments).toHaveLength(1);
    expect(comments[0].authorType).toBe('ai');
    expect(comments[0].authorId).toBe('key_1');

    await ext.addBugComment(ctx, { bug_id: created.bug.id, content: '已定位 NPE' });
    expect(await prisma.bugComment.count({ where: { bugId: created.bug.id } })).toBe(2);
  });

  it('upload_attachment：base64 入 → uploadedBy=密钥 ID', async () => {
    const p = await projectsService.createProject({ name: 'U', slug: 'up' });
    const ctx = { mode: 'keyed' as const, apiKeyId: 'key_up', scopes: new Set(['attachment:write']), actorLabel: 'k(vhk)' };
    const r = await ext.uploadAttachment(ctx, {
      project_slug: 'up',
      bug_id: undefined,
      file_name: 'trace.log',
      file_type: 'text/plain',
      data_base64: Buffer.from('stack trace').toString('base64'),
    });
    expect(r.ok).toBe(true);
    const att = await prisma.attachment.findUnique({ where: { id: r.attachment.id } });
    expect(att?.uploadedBy).toBe('key_up');
  });

  it('update_bug_status 带 ai actor 写评论流', async () => {
    const p = await projectsService.createProject({ name: 'S', slug: 'st' });
    const bug = await bugsService.createBug({ projectId: p.id, title: '状态' });
    await mcpTools.updateBugStatus(
      { bug_id: bug.id, status: 'in_progress', resolution_notes: '修复中', commit_hash: 'cafe1' },
      { type: 'ai', id: 'key_s' },
    );
    const comments = await prisma.bugComment.findMany({ where: { bugId: bug.id } });
    expect(comments[0].authorType).toBe('ai');
    expect(comments[0].content).toContain('cafe1');
  });

  it('状态流转：逐级推进带 next_step，回流必须 reopen_reason，详情给出可走的下一步', async () => {
    const p = await projectsService.createProject({ name: 'F', slug: 'flow' });
    const bug = await bugsService.createBug({ projectId: p.id, title: '流转' });
    const ai = { type: 'ai' as const, id: 'key_f' };

    expect((await mcpTools.getBugDetail({ bug_id: bug.id })).allowed_next_statuses).toEqual(['in_progress']);
    await expect(mcpTools.updateBugStatus({ bug_id: bug.id, status: 'resolved' }, ai)).rejects.toThrow('不允许');

    const s1 = await mcpTools.updateBugStatus({ bug_id: bug.id, status: 'in_progress' }, ai);
    expect(s1.next_step).toContain('resolved');
    const s2 = await mcpTools.updateBugStatus({ bug_id: bug.id, status: 'resolved', resolution_notes: '根因 X，改了 Y，单测覆盖' }, ai);
    expect(s2.allowed_next_statuses).toContain('verified');
    expect(s2.next_step).toContain('验证');

    // 验证不通过：没填原因拒绝，填了才能回流（此前 MCP 不收 reopen_reason，AI 根本退不回去）
    await expect(mcpTools.updateBugStatus({ bug_id: bug.id, status: 'open' }, ai)).rejects.toThrow('reopen_reason');
    const back = await mcpTools.updateBugStatus({ bug_id: bug.id, status: 'open', reopen_reason: '159 上仍复现' }, ai);
    expect(back.bug.status).toBe('open');
    const comments = await prisma.bugComment.findMany({ where: { bugId: bug.id } });
    expect(comments.some((c) => c.content.includes('159 上仍复现'))).toBe(true);
  });

  it('get_project_context 摆出待验证缺陷、doing 任务和流转提醒', async () => {
    const p = await projectsService.createProject({ name: 'C', slug: 'ctx' });
    const ai = { type: 'ai' as const, id: 'key_c' };
    const fixing = await bugsService.createBug({ projectId: p.id, title: '修复中' });
    await mcpTools.updateBugStatus({ bug_id: fixing.id, status: 'in_progress' }, ai);
    const fixed = await bugsService.createBug({ projectId: p.id, title: '已修待验' });
    await mcpTools.updateBugStatus({ bug_id: fixed.id, status: 'in_progress' }, ai);
    await mcpTools.updateBugStatus({ bug_id: fixed.id, status: 'resolved', resolution_notes: 'ok' }, ai);
    await tasksService.createTask({ projectId: p.id, title: '做到一半', status: 'doing' });
    await tasksService.createTask({ projectId: p.id, title: '还没开始' });

    const c = await mcpTools.getProjectContext({ project_slug: 'ctx' });
    expect(c.summary).toMatchObject({ open_bugs: 1, awaiting_verification: 1, todo_tasks: 1, doing_tasks: 1 });
    expect(c.awaiting_verification.map((b) => b.title)).toEqual(['已修待验']);
    expect(c.doing_tasks.map((t) => t.title)).toEqual(['做到一半']);
    expect(c.reminders.join('\n')).toMatch(/in_progress[\s\S]*待验证[\s\S]*doing/);
  });

  it('append_scratchpad 建全局便签并解析标签', async () => {
    const note = await mcpTools.appendScratchpad({ content: '想法', tags: ['idea'] });
    expect(note.tags).toEqual(['idea']);
    expect(note.project_id).toBeNull();
  });

  it('list_bugs 分页整形（默认 20 条）', async () => {
    const p = await projectsService.createProject({ name: 'L', slug: 'lst' });
    for (let i = 0; i < 25; i++) await bugsService.createBug({ projectId: p.id, title: `B${i}` });
    const r = await mcpTools.listBugs({ project_slug: 'lst' });
    expect(r.returned).toBe(20);
    expect(r.total).toBe(25);
    expect(r.has_more).toBe(true);
  });

  it('get_bug_detail 长字段截断', async () => {
    const p = await projectsService.createProject({ name: 'D', slug: 'dtl' });
    const bug = await bugsService.createBug({ projectId: p.id, title: '长文本', actualResult: 'x'.repeat(800) });
    const d = await mcpTools.getBugDetail({ bug_id: bug.id });
    expect(d.actual_result_truncated).toBe(true);
    expect(d.actual_result!.length).toBeLessThan(800);
    expect(d.tip).toContain('read_attachment_text');
  });

  it('read_attachment_text 分片 + grep；非文本拒绝', async () => {
    const p = await projectsService.createProject({ name: 'R', slug: 'rd' });
    const stored = await storage.writeBuffer(Buffer.from('ok line\nERROR boom'), randomIdAttachment(), 'log');
    const att = await attachmentsService.createAttachment({
      projectId: p.id, entityType: 'general', fileName: 'a.log', fileType: 'text/plain', fileSize: 15, storagePath: stored.storagePath,
    });
    const slice = await mcpTools.readAttachmentText({ attachment_id: att.id, grep_keyword: 'ERROR' });
    expect(slice.total_lines).toBe(1);
    expect(slice.content).toContain('L2: ERROR boom');

    const png = await storage.writeBuffer(
      await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer(),
      randomIdAttachment(), 'png',
    );
    const imgAtt = await attachmentsService.createAttachment({
      projectId: p.id, entityType: 'general', fileName: 'a.png', fileType: 'image/png', fileSize: 100, storagePath: png.storagePath,
    });
    await expect(mcpTools.readAttachmentText({ attachment_id: imgAtt.id })).rejects.toThrow('不是文本类型');
  });

  it('inspect_image_asset 降采样 + base64 模式', async () => {
    const p = await projectsService.createProject({ name: 'I', slug: 'img' });
    const png = await storage.writeBuffer(
      await sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer(),
      randomIdAttachment(), 'png',
    );
    const att = await attachmentsService.createAttachment({
      projectId: p.id, entityType: 'general', fileName: 'big.png', fileType: 'image/png', fileSize: 100, storagePath: png.storagePath,
    });
    const pathMode = await mcpTools.inspectImageAssetTool({ attachment_id: att.id });
    expect(pathMode.downscaled).toBe(true);
    expect(pathMode.width).toBe(1080);
    const b64 = await mcpTools.inspectImageAssetTool({ attachment_id: att.id, target_max_dimension: 400, return_mode: 'base64' });
    expect(typeof b64.base64).toBe('string');
  });

  it('search / list_notes / list_tasks / update_task / purge_trash', async () => {
    const p = await projectsService.createProject({ name: '搜索项目', slug: 'srch' });
    await bugsService.createBug({ projectId: p.id, title: '独特的西瓜缺陷' });
    await tasksService.createTask({ projectId: p.id, title: '任务甲' });
    const ctx = { mode: 'local' as const, apiKeyId: null, scopes: new Set(['admin']), actorLabel: 'local' };

    const search = await ext.search(ctx, { q: '西瓜' });
    expect(search.bugs).toHaveLength(1);

    const notes = await ext.listNotes(ctx, {});
    expect(notes.total).toBe(0);

    const tasks = await ext.listTasks(ctx, { project_slug: 'srch' });
    expect(tasks.tasks).toHaveLength(1);
    const t = await ext.updateTask(ctx, { task_id: tasks.tasks[0].id, status: 'doing' });
    expect(t.task.status).toBe('doing');

    const purged = await ext.purgeTrash(ctx, {});
    expect(purged.ok).toBe(true);
  });

  it('create_task：缺省值 / 指定状态 / 关联附件 / 校验，update_task 可改标题描述', async () => {
    const p = await projectsService.createProject({ name: '任务项目', slug: 'tsk' });
    await projectsService.createProject({ name: '另一个项目', slug: 'other' });
    const ctx = { mode: 'local' as const, apiKeyId: null, scopes: new Set(['admin']), actorLabel: 'local' };

    const a = await ext.createTask(ctx, { project_slug: 'tsk', title: '  补验收用例  ', description: '详情 **md**' });
    expect(a.task).toMatchObject({ title: '补验收用例', status: 'todo', priority: 'medium', project_slug: 'tsk' });
    const row = await prisma.task.findUnique({ where: { id: a.task.id } });
    expect(row).toMatchObject({ projectId: p.id, description: '详情 **md**' });

    const att = await attachmentsService.createAttachment({
      projectId: p.id, entityType: 'general', fileName: 'log.txt', fileType: 'text/plain', fileSize: 1, storagePath: 'x/log.txt',
    });
    const b = await ext.createTask(ctx, {
      project_slug: 'tsk', title: '已在做', priority: 'high', status: 'doing', attachment_ids: [att.id],
    });
    expect(b.task).toMatchObject({ status: 'doing', priority: 'high' });
    expect(b.next_step).toContain('review');
    expect(await prisma.attachment.findUnique({ where: { id: att.id } })).toMatchObject({ entityType: 'task', entityId: b.task.id });

    // 多项目不传 slug 必须报错，不能静默落进别的项目
    await expect(ext.createTask(ctx, { title: 'x' })).rejects.toThrow('project_slug');
    await expect(ext.createTask(ctx, { project_slug: 'tsk', title: '   ' })).rejects.toThrow('title');
    await expect(ext.createTask(ctx, { project_slug: 'tsk', title: 'x', status: 'blocked' })).rejects.toThrow('status');
    await expect(ext.createTask(ctx, { project_slug: 'nope', title: 'x' })).rejects.toThrow('项目不存在');

    const listed = await ext.listTasks(ctx, { project_slug: 'tsk', status: 'todo' });
    expect(listed.tasks).toHaveLength(1);
    expect(listed.tasks[0].description).toBe('详情 **md**');

    const u = await ext.updateTask(ctx, { task_id: a.task.id, title: '改后标题', description: '新描述', status: 'doing' });
    expect(u.task).toMatchObject({ title: '改后标题', status: 'doing' });
    expect(await prisma.task.findUnique({ where: { id: a.task.id } })).toMatchObject({ description: '新描述', priority: 'medium' });
    await expect(ext.updateTask(ctx, { task_id: a.task.id, title: ' ' })).rejects.toThrow('title');
  });

  it('空 q 校验拒绝', async () => {
    const ctx = { mode: 'local' as const, apiKeyId: null, scopes: new Set(['admin']), actorLabel: 'local' };
    await expect(ext.search(ctx, { q: '' })).rejects.toThrow('q');
  });
});
