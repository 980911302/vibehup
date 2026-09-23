import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb, createUser } from '../test-helpers.js';
import * as bugsService from './bugs.js';
import * as bugComments from './bug-comments.js';
import * as bugTemplates from './bug-templates.js';
import * as savedViews from './saved-views.js';
import * as bugImport from './bug-import.js';
import { BUG_TRANSITIONS } from './bugs.js';

/** 缺陷域单测（步骤 05：18 例） */

beforeEach(async () => {
  await resetDb();
});

async function seedProject() {
  return prisma.project.create({ data: { id: 'prj_dom', name: '缺陷域', slug: 'dom' } });
}

describe('状态机', () => {
  it('合法迁移通过，非法迁移 400 人话', async () => {
    const p = await seedProject();
    const bug = await bugsService.createBug({ projectId: p.id, title: '状态机' });
    // 合法：open → in_progress → resolved
    const mid = await bugsService.updateBug(bug.id, { status: 'in_progress' });
    expect(mid.status).toBe('in_progress');
    const done = await bugsService.updateBug(bug.id, { status: 'resolved' });
    expect(done.status).toBe('resolved');
    // 非法：resolved → in_progress 允许（回流），但 closed → resolved 不允许
    const bug2 = await bugsService.createBug({ projectId: p.id, title: '状态机2' });
    await bugsService.updateBug(bug2.id, { status: 'in_progress' });
    await bugsService.updateBug(bug2.id, { status: 'resolved' });
    await bugsService.updateBug(bug2.id, { status: 'verified' });
    await bugsService.updateBug(bug2.id, { status: 'closed' });
    await expect(bugsService.updateBug(bug2.id, { status: 'resolved' })).rejects.toThrow('不允许');
  });

  it('resolved → open 需 reason；带 reason 后 reopenedCount+1 且评论流记录', async () => {
    const p = await seedProject();
    const bug = await bugsService.createBug({ projectId: p.id, title: '重开' });
    await bugsService.updateBug(bug.id, { status: 'in_progress' });
    await bugsService.updateBug(bug.id, { status: 'resolved' });

    await expect(bugsService.updateBug(bug.id, { status: 'open' })).rejects.toThrow('重开原因');
    const reopened = await bugsService.updateBug(bug.id, { status: 'open', reopenReason: '复验不过' });
    expect(reopened.status).toBe('open');
    expect(reopened.reopenedCount).toBe(1);

    const comments = await bugComments.listComments(bug.id);
    const reopenComment = comments.find((c) => c.content.includes('重开原因'));
    expect(reopenComment).toBeDefined();
    expect(reopenComment!.content).toContain('复验不过');
  });

  it('状态变化自动写评论（含修复说明与 commit）', async () => {
    const p = await seedProject();
    const bug = await bugsService.createBug({ projectId: p.id, title: '留痕' });
    await bugsService.updateBug(bug.id, {
      status: 'in_progress',
    });
    await bugsService.updateBug(bug.id, {
      status: 'resolved',
      resolutionNotes: '已修复',
      gitCommitHash: 'abc1234',
      actor: { type: 'ai', id: 'key_x' },
    });
    const comments = await bugComments.listComments(bug.id);
    expect(comments).toHaveLength(2);
    expect(comments[0].author_type).toBe('ai');
    expect(comments[0].content).toContain('abc1234');
    expect(comments[0].content).toContain('已修复');
  });

  it('BUG_TRANSITIONS 覆盖文档状态机全部边', () => {
    expect(BUG_TRANSITIONS.open).toEqual(['in_progress']);
    expect(BUG_TRANSITIONS.resolved).toContain('verified');
    expect(BUG_TRANSITIONS.resolved).toContain('open');
    expect(BUG_TRANSITIONS.verified).toContain('open');
    expect(BUG_TRANSITIONS.closed).toEqual(['open']);
  });
});

describe('指派与字段', () => {
  it('createBug 支持 priority/assignee/dueDate/labels', async () => {
    const p = await seedProject();
    const u = await createUser({ name: '被指派人' }); // 外键约束（R74）需真实用户
    const bug = await bugsService.createBug({
      projectId: p.id,
      title: '字段',
      priority: 'high',
      assigneeId: u.user.id,
      dueDate: '2026-10-01',
      labels: ['ui', 'p0'],
    });
    expect(bug.priority).toBe('high');
    expect(bug.assigneeId).toBe(u.user.id);
    expect(bug.dueDate?.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(bug.labels).toEqual(['ui', 'p0']);
  });

  it('非法 severity/priority 拒绝', async () => {
    const p = await seedProject();
    await expect(bugsService.createBug({ projectId: p.id, title: 'x', severity: 'x' })).rejects.toThrow('severity');
    await expect(bugsService.createBug({ projectId: p.id, title: 'x', priority: 'x' })).rejects.toThrow('priority');
  });
});

describe('模板', () => {
  it('空库首次列表惰性创建三个默认模板（幂等）', async () => {
    const first = await bugTemplates.listTemplates();
    expect(first.map((t) => t.name)).toEqual(['缺陷报告', '需求跟进', '线上事故']);
    const second = await bugTemplates.listTemplates();
    expect(second).toHaveLength(3);
  });

  it('CRUD 与 getTemplate', async () => {
    const created = await bugTemplates.createTemplate({ name: '自定义', titleTemplate: '[T] {x}', fields: { severity: 'low' } });
    const fetched = await bugTemplates.getTemplate(created.id);
    expect(fetched?.fields.severity).toBe('low');
    await bugTemplates.updateTemplate(created.id, { name: '改名' });
    expect((await bugTemplates.getTemplate(created.id))?.name).toBe('改名');
    await bugTemplates.deleteTemplate(created.id);
    await expect(bugTemplates.getTemplate(created.id)).resolves.toBeNull();
  });

  it('assertTemplateManageable 拦截非管理员', async () => {
    expect(() => bugTemplates.assertTemplateManageable('member')).toThrow('管理员');
    expect(() => bugTemplates.assertTemplateManageable('admin')).not.toThrow();
  });
});

describe('保存视图', () => {
  it('创建/默认唯一/同名冲突/删除', async () => {
    const u = await createUser({ email: 'v@t.com', name: 'V' });
    const v1 = await savedViews.createView(u.user.id, { entity: 'bug', name: '视图一', is_default: true });
    expect(v1.is_default).toBe(true);
    const v2 = await savedViews.createView(u.user.id, { entity: 'bug', name: '视图二', is_default: true });
    expect(v2.is_default).toBe(true);
    const list = await savedViews.listViews(u.user.id, 'bug');
    expect(list.filter((v) => v.is_default)).toHaveLength(1);
    await expect(savedViews.createView(u.user.id, { entity: 'bug', name: '视图一' })).rejects.toThrow('同名');
    await savedViews.deleteView(u.user.id, v1.id);
    expect(await savedViews.listViews(u.user.id)).toHaveLength(1);
  });
});

describe('CSV 导入导出', () => {
  it('导出带 BOM；导入 round-trip 列内字段一致；坏行带原因', async () => {
    const p = await seedProject();
    await bugsService.createBug({ projectId: p.id, title: '导出甲', severity: 'high', priority: 'high', labels: ['ui'] });

    const csv = await bugImport.exportBugsCsv(p.id);
    expect(csv.charCodeAt(0)).toBe(0xfeff);

    const before = await prisma.bug.count({ where: { projectId: p.id } });
    const result = await bugImport.importBugsCsv(p.id, csv + '\n坏行甲,normal,坏状态,,,,\n');
    expect(result.imported).toBe(1);
    expect(result.results.filter((r) => !r.ok)[0].reason).toContain('状态非法');

    const after = await prisma.bug.count({ where: { projectId: p.id } });
    expect(after).toBe(before + 1);
    const rows = await prisma.bug.findMany({ where: { projectId: p.id, title: '导出甲' } });
    expect(rows.every((r) => r.severity === 'high' && r.priority === 'high' && r.labels[0] === 'ui')).toBe(true);
  });

  it('表头不匹配拒绝；指派邮箱无匹配用户逐行失败', async () => {
    const p = await seedProject();
    await expect(bugImport.importBugsCsv(p.id, '错,误\nx,y')).rejects.toThrow('表头');
    const badCsv = '标题,严重度,状态,指派邮箱,标签,优先级,截止日,复现步骤\n甲,normal,open,nobody@t.com,,medium,,';
    const r = await bugImport.importBugsCsv(p.id, badCsv);
    expect(r.imported).toBe(0);
    expect(r.results[0].reason).toContain('无匹配用户');
  });

  it('指派邮箱匹配到用户', async () => {
    const p = await seedProject();
    const u = await createUser({ email: 'dev@t.com', name: 'Dev' });
    const csv = '标题,严重度,状态,指派邮箱,标签,优先级,截止日,复现步骤\n甲,normal,open,dev@t.com,,medium,,';
    const r = await bugImport.importBugsCsv(p.id, csv);
    expect(r.imported).toBe(1);
    const bug = await prisma.bug.findFirst({ where: { projectId: p.id } });
    expect(bug?.assigneeId).toBe(u.user.id);
  });
});

describe('moveBugToProject', () => {
  it('跨项目移动；目标不存在拒绝', async () => {
    const p1 = await seedProject();
    const p2 = await prisma.project.create({ data: { id: 'prj_dom2', name: 'P2', slug: 'dom2' } });
    const bug = await bugsService.createBug({ projectId: p1.id, title: '移动' });
    await bugsService.moveBugToProject(bug.id, p2.id);
    expect((await prisma.bug.findUnique({ where: { id: bug.id } }))?.projectId).toBe(p2.id);
    await expect(bugsService.moveBugToProject(bug.id, 'prj_none')).rejects.toThrow('目标项目不存在');
  });
});

describe('assignee 关联查询（卡片 49）', () => {
  it('listBugs/getBug/getBugBoard 返回 assignee 摘要，序列化带 name', async () => {
    const p = await seedProject();
    const u = await createUser({ name: '张三' });
    const bug = await bugsService.createBug({ projectId: p.id, title: '指派查询', assigneeId: u.user.id });

    const list = await bugsService.listBugs({ projectId: p.id });
    expect(list.items[0].assignee?.id).toBe(u.user.id);
    expect(list.items[0].assignee?.name).toBe('张三');

    const board = await bugsService.getBugBoard(p.id);
    expect(board.open[0].assignee?.name).toBe('张三');

    const detail = await bugsService.getBug(bug.id);
    expect(detail.assignee?.name).toBe('张三');
  });

  it('未指派缺陷的 assignee 为 null（不报错）', async () => {
    const p = await seedProject();
    await bugsService.createBug({ projectId: p.id, title: '无指派' });
    const list = await bugsService.listBugs({ projectId: p.id });
    expect(list.items[0].assignee).toBeNull();
  });

  it('updateBug 可改派 assigneeId', async () => {
    const p = await seedProject();
    const u = await createUser({ name: '李四' });
    const bug = await bugsService.createBug({ projectId: p.id, title: '改派' });
    const updated = await bugsService.updateBug(bug.id, { assigneeId: u.user.id });
    expect(updated.assigneeId).toBe(u.user.id);
    const cleared = await bugsService.updateBug(bug.id, { assigneeId: null });
    expect(cleared.assigneeId).toBeNull();
  });
});
