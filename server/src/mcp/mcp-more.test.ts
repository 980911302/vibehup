import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb, createUser } from '../test-helpers.js';
import * as projectsService from '../services/projects.js';
import * as bugsService from '../services/bugs.js';
import * as tasksService from '../services/tasks.js';
import * as notesService from '../services/notes.js';
import * as attachmentsService from '../services/attachments.js';
import * as ext from './tools-extended.js';
import * as mcpTools from './tools.js';
import * as more from './tools-more.js';
import * as skillTools from './tools-skills.js';
import { TOOL_NAMES } from './server.js';
import { TOOL_SCOPES } from './tool-scopes.js';
import { SCOPES } from './scopes.js';
import type { McpContext } from './context.js';

/** MCP 补全：任务详情/删除、缺陷/便签/附件的删除与便签修改、技能上传/查看/下载/删除 */

const ctx: McpContext = { mode: 'keyed', apiKeyId: 'key_ai', scopes: new Set(['admin']), actorLabel: 'cursor' };

const md = (name: string, description = '团队约定的发布流程') => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

beforeEach(async () => {
  await resetDb();
});

describe('工具与权限', () => {
  it('27 个工具，每个都声明了所需 scope；删除跟着对应写权限，技能读取只要 context:read', () => {
    expect(TOOL_NAMES).toHaveLength(27);
    expect(Object.keys(TOOL_SCOPES).sort()).toEqual([...TOOL_NAMES].sort());
    for (const scope of Object.values(TOOL_SCOPES)) expect(SCOPES).toContain(scope);
    expect(TOOL_SCOPES).toMatchObject({
      get_task_detail: 'task:read',
      delete_task: 'task:write',
      delete_bug: 'bug:write',
      update_note: 'note:write',
      delete_note: 'note:write',
      delete_attachment: 'attachment:write',
      list_skills: 'context:read',
      download_skill: 'context:read',
      upload_skill: 'skill:write',
      delete_skill: 'skill:write',
      create_upload_url: 'attachment:write',
    });
  });
});

describe('任务', () => {
  it('get_task_detail：标签、负责人名字、附件、可走的下一步；长描述默认截断，full=true 给全文', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const u = await createUser({ name: '王强' });
    const t = await tasksService.createTask({
      projectId: p.id, title: '导出', description: 'x'.repeat(800), labels: ['后端'], assigneeId: u.user.id,
    });
    await prisma.attachment.create({
      data: { id: 'att_x', projectId: p.id, entityType: 'task', entityId: t.id, fileName: 'spec.md', fileType: 'text/markdown', fileSize: 3, storagePath: 'x' },
    });
    const d = await more.getTaskDetail(ctx, { task_id: t.id });
    expect(d).toMatchObject({
      title: '导出', labels: ['后端'], assignee: { id: u.user.id, name: '王强' }, status: 'todo',
      allowed_next_statuses: ['doing', 'cancelled'], description_truncated: true, project_slug: 'p',
    });
    expect(d.next_step).toContain('doing');
    expect(d.attachments.map((a) => a.file_name)).toEqual(['spec.md']);
    expect((await more.getTaskDetail(ctx, { task_id: t.id, full: true })).description).toHaveLength(800);
  });

  it('update_task：逐级流转、打回写原因、改标签；list_tasks 可按标签过滤并带标签', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const t = await tasksService.createTask({ projectId: p.id, title: 'A' });
    await tasksService.createTask({ projectId: p.id, title: 'B', labels: ['前端'] });

    await expect(ext.updateTask(ctx, { task_id: t.id, status: 'review' })).rejects.toThrow('不能从「待办」直接改为「待验证」');
    await ext.updateTask(ctx, { task_id: t.id, status: 'doing' });
    const r = await ext.updateTask(ctx, { task_id: t.id, status: 'review', labels: ['后端'] });
    expect(r.task).toMatchObject({ status: 'review', labels: ['后端'] });
    expect(r.allowed_next_statuses).toEqual(['verifying', 'doing', 'cancelled']);
    expect(r.next_step).toContain('验收');

    await expect(ext.updateTask(ctx, { task_id: t.id, status: 'doing' })).rejects.toThrow('reopen_reason');
    const back = await ext.updateTask(ctx, { task_id: t.id, status: 'doing', reopen_reason: '导出为空' });
    expect(back.task.status).toBe('doing');

    const listed = await ext.listTasks(ctx, { project_slug: 'p', label: '前端' });
    expect(listed.tasks.map((x) => [x.title, x.labels])).toEqual([['B', ['前端']]]);
  });

  it('create_task 可带标签', async () => {
    await projectsService.createProject({ name: 'P', slug: 'p' });
    const c = await ext.createTask(ctx, { project_slug: 'p', title: 'T', labels: ['ai', ' ai '] });
    expect(c.task.labels).toEqual(['ai']);
  });

  it('delete_task', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const t = await tasksService.createTask({ projectId: p.id, title: '删' });
    expect(await more.deleteTask(ctx, { task_id: t.id })).toMatchObject({ ok: true, deleted: { id: t.id, title: '删' } });
    expect(await prisma.task.count()).toBe(0);
    await expect(more.deleteTask(ctx, { task_id: t.id })).rejects.toThrow('任务不存在');
  });
});

describe('缺陷 / 便签 / 附件', () => {
  it('delete_bug 连同评论一起删', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const b = await bugsService.createBug({ projectId: p.id, title: '重复单' });
    await bugsService.updateBug(b.id, { status: 'in_progress' });
    expect(await more.deleteBug(ctx, { bug_id: b.id })).toMatchObject({ ok: true, deleted: { id: b.id, title: '重复单' } });
    expect(await prisma.bug.count()).toBe(0);
    expect(await prisma.bugComment.count()).toBe(0);
  });

  it('update_note 改内容/标签/置顶；delete_note', async () => {
    const n = await notesService.createNote({ projectId: null, content: '旧', tags: ['a'] });
    const u = await more.updateNote(ctx, { note_id: n.id, content: '新', tags: ['b'], pinned: true });
    expect(u.note).toMatchObject({ content: '新', tags: ['b'], pinned: true });
    await expect(more.updateNote(ctx, { note_id: n.id })).rejects.toThrow('至少');
    expect(await more.deleteNote(ctx, { note_id: n.id })).toMatchObject({ ok: true });
    expect(await prisma.note.count()).toBe(0);
  });

  it('delete_attachment', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const a = await attachmentsService.uploadFromBuffer({
      projectId: p.id, fileName: 'x.log', fileType: 'text/plain', buffer: Buffer.from('log'), uploadedBy: 'key_ai',
    });
    expect(await more.deleteAttachment(ctx, { attachment_id: a.id })).toMatchObject({ ok: true, deleted: { id: a.id, file_name: 'x.log' } });
    expect(await prisma.attachment.count()).toBe(0);
  });
});

describe('技能', () => {
  it('upload_skill：默认挂当前项目，scope=global 为通用；同名覆盖；记来源 ai 与密钥', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const a = await skillTools.uploadSkill(ctx, {
      project_slug: 'p', skill_md: md('release'),
      files: [{ path: 'scripts/check.sh', content: 'echo ok' }, { path: 'img.png', content_base64: Buffer.from([0x89, 0]).toString('base64') }],
    });
    expect(a).toMatchObject({ ok: true, action: 'created', skill: { name: 'release', scope: 'project', project_slug: 'p', file_count: 2 } });
    const row = await prisma.skill.findFirst({ where: { name: 'release' } });
    expect(row).toMatchObject({ projectId: p.id, source: 'ai', uploadedBy: 'key_ai' });

    const again = await skillTools.uploadSkill(ctx, { project_slug: 'p', skill_md: md('release', '新版') });
    expect(again.action).toBe('updated');

    const g = await skillTools.uploadSkill(ctx, { scope: 'global', skill_md: md('release') });
    expect(g.skill).toMatchObject({ scope: 'global', project_slug: null });
  });

  it('list_skills 只给名称和描述（本项目 + 通用）', async () => {
    await projectsService.createProject({ name: 'P', slug: 'p' });
    await projectsService.createProject({ name: 'O', slug: 'o' });
    await skillTools.uploadSkill(ctx, { project_slug: 'p', skill_md: md('p-skill') });
    await skillTools.uploadSkill(ctx, { scope: 'global', skill_md: md('g-skill', '所有项目通用') });
    await skillTools.uploadSkill(ctx, { project_slug: 'o', skill_md: md('o-skill') });
    const l = await skillTools.listSkills(ctx, { project_slug: 'p' });
    expect(l.skills).toEqual([
      expect.objectContaining({ name: 'g-skill', description: '所有项目通用', scope: 'global' }),
      expect.objectContaining({ name: 'p-skill', scope: 'project' }),
    ]);
    expect(l.skills[0]).not.toHaveProperty('content');
    expect(l.tip).toContain('download_skill');
  });

  it('download_skill：SKILL.md + 文本文件内容 + 二进制 base64；项目内同名优先', async () => {
    await projectsService.createProject({ name: 'P', slug: 'p' });
    await skillTools.uploadSkill(ctx, { scope: 'global', skill_md: md('dup', '通用版') });
    await skillTools.uploadSkill(ctx, {
      project_slug: 'p', skill_md: md('dup', '项目版'),
      files: [{ path: 'a.sh', content: 'echo a' }, { path: 'b.bin', content_base64: Buffer.from([0, 1, 2]).toString('base64') }],
    });
    const d = await skillTools.downloadSkill(ctx, { name: 'dup', project_slug: 'p' });
    expect(d).toMatchObject({ name: 'dup', description: '项目版', complete: true, install_dir: '.claude/skills/dup' });
    expect(d.skill_md).toContain('项目版');
    expect(d.files).toEqual([
      { path: 'a.sh', size: 6, is_text: true, content: 'echo a' },
      { path: 'b.bin', size: 3, is_text: false, content_base64: Buffer.from([0, 1, 2]).toString('base64') },
    ]);
    await expect(skillTools.downloadSkill(ctx, { name: 'nope', project_slug: 'p' })).rejects.toThrow('list_skills');
  });

  it('download_skill：内容太多时分批，余下文件按 path 分段取', async () => {
    await projectsService.createProject({ name: 'P', slug: 'p' });
    const big = 'y'.repeat(30_000);
    await skillTools.uploadSkill(ctx, {
      project_slug: 'p', skill_md: md('big'),
      files: [{ path: 'a.txt', content: big }, { path: 'b.txt', content: big }, { path: 'c.txt', content: 'small' }],
    });
    const d = await skillTools.downloadSkill(ctx, { name: 'big', project_slug: 'p' });
    expect(d.complete).toBe(false);
    expect(d.files[0].content).toHaveLength(30_000);
    expect(d.files[1]).toMatchObject({ path: 'b.txt', pending: true });
    expect(d.tip).toContain('path');

    const part = await skillTools.downloadSkill(ctx, { name: 'big', project_slug: 'p', path: 'b.txt' });
    expect(part).toMatchObject({ path: 'b.txt', offset: 0, next_offset: null });
    expect(part.content).toHaveLength(30_000);

    const huge = 'z'.repeat(100_000);
    await skillTools.uploadSkill(ctx, { project_slug: 'p', skill_md: md('huge'), files: [{ path: 'h.txt', content: huge }] });
    const c1 = await skillTools.downloadSkill(ctx, { name: 'huge', project_slug: 'p', path: 'h.txt' });
    expect(c1.next_offset).toBe(40_000);
    const c3 = await skillTools.downloadSkill(ctx, { name: 'huge', project_slug: 'p', path: 'h.txt', offset: 80_000 });
    expect(c3).toMatchObject({ offset: 80_000, next_offset: null });
    expect(c3.content).toHaveLength(20_000);
  });

  it('get_project_context 列出技能（名称+描述）与待验证任务，并提醒验收', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    await skillTools.uploadSkill(ctx, { project_slug: 'p', skill_md: md('ctx-skill', '项目专用') });
    const t = await tasksService.createTask({ projectId: p.id, title: '等验收', status: 'doing' });
    await tasksService.updateTask(t.id, { status: 'review' });
    const c = await mcpTools.getProjectContext({ project_slug: 'p' });
    expect(c.summary).toMatchObject({ review_tasks: 1, skills: 1 });
    expect(c.skills).toEqual([{ name: 'ctx-skill', description: '项目专用', scope: 'project' }]);
    expect(c.review_tasks.map((x) => x.title)).toEqual(['等验收']);
    expect(c.reminders.join('\n')).toContain('待验证（review）');
  });

  it('delete_skill 按名字删（项目内优先）', async () => {
    await projectsService.createProject({ name: 'P', slug: 'p' });
    await skillTools.uploadSkill(ctx, { project_slug: 'p', skill_md: md('bye') });
    expect(await skillTools.deleteSkill(ctx, { name: 'bye', project_slug: 'p' })).toMatchObject({ ok: true, deleted: { name: 'bye', scope: 'project' } });
    expect(await prisma.skill.count()).toBe(0);
  });
});
