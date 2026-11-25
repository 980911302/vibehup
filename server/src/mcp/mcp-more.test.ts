import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb, createUser } from '../test-helpers.js';
import * as projectsService from '../services/projects.js';
import * as tasksService from '../services/tasks.js';
import * as skillsService from '../services/skills.js';
import * as mcpTools from './tools.js';
import * as workTools from './tools-work.js';
import * as skillTools from './tools-skills.js';
import { TOOL_NAMES } from './server.js';
import { TOOL_SCOPES } from './tool-scopes.js';
import { SCOPES } from './scopes.js';
import type { McpContext } from './context.js';

const ctx: McpContext = { mode: 'keyed', apiKeyId: 'key_ai', scopes: new Set(['admin']), actorLabel: 'cursor' };

const md = (name: string, description = '团队约定的发布流程') => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

async function seedSkill(projectId: string | null, skillMd: string, files: { path: string; content?: string; content_base64?: string }[] = []) {
  return skillsService.uploadSkill({
    projectId,
    skillMd,
    files: files.map((f) => ({
      path: f.path,
      data: f.content_base64 !== undefined ? Buffer.from(f.content_base64, 'base64') : Buffer.from(f.content ?? '', 'utf8'),
    })),
    source: 'web',
    uploadedBy: null,
  });
}

beforeEach(async () => {
  await resetDb();
});

describe('工具与权限（R96 9 工具）', () => {
  it('9 个工具均在 TOOL_SCOPES 中声明合法 scope', () => {
    expect(TOOL_NAMES).toHaveLength(9);
    expect(Object.keys(TOOL_SCOPES).sort()).toEqual([...TOOL_NAMES].sort());
    for (const list of Object.values(TOOL_SCOPES)) {
      for (const s of list) expect(SCOPES).toContain(s);
    }
  });
});

describe('任务详情与流转', () => {
  it('get_work_item(task)：标签、负责人名字、附件、可走的下一步；长描述默认截断，full=true 给全文', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const u = await createUser({ name: '王强' });
    const t = await tasksService.createTask({
      projectId: p.id, title: '导出', description: 'x'.repeat(800), labels: ['后端'], assigneeId: u.user.id,
    });
    await prisma.attachment.create({
      data: { id: 'att_x', projectId: p.id, entityType: 'task', entityId: t.id, fileName: 'spec.md', fileType: 'text/markdown', fileSize: 3, storagePath: 'x' },
    });
    const d = await workTools.getWorkItem(ctx, { id: t.id });
    expect(d).toMatchObject({
      entity_type: 'task',
      title: '导出',
      labels: ['后端'],
      assignee: { id: u.user.id, name: '王强' },
      status: 'todo',
      allowed_next_statuses: ['doing', 'cancelled'],
      description_truncated: true,
      project_slug: 'p',
    });
    expect(d.next_step).toContain('doing');
    expect(d.attachments.map((a) => a.file_name)).toEqual(['spec.md']);
    expect((await workTools.getWorkItem(ctx, { id: t.id, full: true }) as { description: string }).description).toHaveLength(800);
  });

  it('update_work_item(task)：逐级流转、打回写原因、改标签；search 可按标签过滤任务', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const t = await tasksService.createTask({ projectId: p.id, title: 'A' });
    await tasksService.createTask({ projectId: p.id, title: 'B', labels: ['前端'] });

    await expect(workTools.updateWorkItem(ctx, { id: t.id, status: 'review' })).rejects.toThrow('不能从「待办」直接改为「待验证」');
    await workTools.updateWorkItem(ctx, { id: t.id, status: 'doing' });
    const r = await workTools.updateWorkItem(ctx, { id: t.id, status: 'review', labels: ['后端'] });
    expect(r.task).toMatchObject({ status: 'review', labels: ['后端'] });
    expect(r.allowed_next_statuses).toEqual(['verifying', 'doing', 'cancelled']);
    expect(r.next_step).toContain('验收');

    await expect(workTools.updateWorkItem(ctx, { id: t.id, status: 'doing' })).rejects.toThrow('reopen_reason');
    const back = await workTools.updateWorkItem(ctx, { id: t.id, status: 'doing', reopen_reason: '导出为空' });
    expect(back.task?.status).toBe('doing');

    const listed = await mcpTools.search(ctx, { project_slug: 'p', type: 'task', label: '前端' });
    expect(listed.tasks?.items.map((x) => [x.title, x.labels])).toEqual([['B', ['前端']]]);
  });

  it('create_work_item(task) 可带标签并自动去重', async () => {
    await projectsService.createProject({ name: 'P', slug: 'p' });
    const c = await workTools.createWorkItem(ctx, { type: 'task', project_slug: 'p', title: 'T', labels: ['ai', ' ai '] });
    expect(c.task?.labels).toEqual(['ai']);
  });
});

describe('技能读取（get_project_context.skills + get_skill）', () => {
  it('get_skill：SKILL.md + 文本文件内容 + 二进制 base64；项目内同名优先于全局', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    await seedSkill(null, md('dup', '通用版'));
    await seedSkill(p.id, md('dup', '项目版'), [
      { path: 'a.sh', content: 'echo a' },
      { path: 'b.bin', content_base64: Buffer.from([0, 1, 2]).toString('base64') },
    ]);
    const d = await skillTools.getSkill(ctx, { name: 'dup', project_slug: 'p' });
    expect(d).toMatchObject({ name: 'dup', description: '项目版', complete: true, install_dir: '.claude/skills/dup' });
    expect(d.skill_md).toContain('项目版');
    expect(d.files).toEqual([
      { path: 'a.sh', size: 6, is_text: true, content: 'echo a' },
      { path: 'b.bin', size: 3, is_text: false, content_base64: Buffer.from([0, 1, 2]).toString('base64') },
    ]);
    await expect(skillTools.getSkill(ctx, { name: 'nope', project_slug: 'p' })).rejects.toThrow('get_project_context');
  });

  it('get_skill：内容太多时分批，余下文件按 path 与 offset 分段取', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    const big = 'y'.repeat(30_000);
    await seedSkill(p.id, md('big'), [
      { path: 'a.txt', content: big },
      { path: 'b.txt', content: big },
      { path: 'c.txt', content: 'small' },
    ]);
    const d = await skillTools.getSkill(ctx, { name: 'big', project_slug: 'p' });
    expect(d.complete).toBe(false);
    expect(d.files[0].content).toHaveLength(30_000);
    expect(d.files[1]).toMatchObject({ path: 'b.txt', pending: true });
    expect(d.tip).toContain('get_skill');

    const part = await skillTools.getSkill(ctx, { name: 'big', project_slug: 'p', path: 'b.txt' });
    expect(part).toMatchObject({ path: 'b.txt', offset: 0, next_offset: null });
    expect(part.content).toHaveLength(30_000);

    const huge = 'z'.repeat(100_000);
    await seedSkill(p.id, md('huge'), [{ path: 'h.txt', content: huge }]);
    const c1 = await skillTools.getSkill(ctx, { name: 'huge', project_slug: 'p', path: 'h.txt' });
    expect(c1.next_offset).toBe(40_000);
    const c3 = await skillTools.getSkill(ctx, { name: 'huge', project_slug: 'p', path: 'h.txt', offset: 80_000 });
    expect(c3).toMatchObject({ offset: 80_000, next_offset: null });
    expect(c3.content).toHaveLength(20_000);
  });

  it('get_project_context 列出技能（名称+描述，含本项目与通用）与待验证任务，并提醒验收', async () => {
    const p = await projectsService.createProject({ name: 'P', slug: 'p' });
    await seedSkill(p.id, md('ctx-skill', '项目专用'));
    const t = await tasksService.createTask({ projectId: p.id, title: '等验收', status: 'doing' });
    await tasksService.updateTask(t.id, { status: 'review' });
    const c = await mcpTools.getProjectContext(ctx, { project_slug: 'p' });
    expect(c.summary).toMatchObject({ review_tasks: 1, skills: 1 });
    expect(c.skills).toEqual([{ name: 'ctx-skill', description: '项目专用', scope: 'project' }]);
    expect(c.review_tasks.map((x) => x.title)).toEqual(['等验收']);
    expect(c.reminders.join('\n')).toContain('待验证（review）');
  });
});
