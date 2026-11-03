import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../core/prisma.js';
import { createUser, resetDb } from '../test-helpers.js';
import type { McpContext } from './context.js';
import * as identity from './identity.js';
import * as bugsService from '../services/bugs.js';
import * as tasksService from '../services/tasks.js';

beforeEach(async () => {
  await resetDb();
});

function ctx(overrides: Partial<McpContext> = {}): McpContext {
  return {
    mode: 'keyed',
    apiKeyId: 'key_test',
    scopes: new Set(['context:read', 'bug:write', 'task:write', 'admin']),
    actorLabel: 'test-key',
    actorName: 'Cursor',
    human: null,
    key: null,
    ...overrides,
  };
}

async function seedProject() {
  return prisma.project.create({ data: { id: 'prj_id', name: '身份测试', slug: 'identity' } });
}

describe('MCP 身份与交接（R90）', () => {
  it('get_me 返回人类、密钥、能力与项目', async () => {
    const owner = await createUser({ email: 'owner@t.com', name: '林深' });
    const project = await seedProject();
    const me = await identity.getMe(
      ctx({ human: { id: owner.user.id, name: '林深', role: 'owner' }, key: { id: 'k1', name: 'Cursor', prefix: 'vhk_live_abc' } }),
      { project_slug: project.slug },
    );
    expect(me.human?.name).toBe('林深');
    expect(me.key?.name).toBe('Cursor');
    expect(me.capabilities).toContain('bug:write');
    expect(me.project?.slug).toBe('identity');
  });

  it('list_members 只列 active，非 admin 不带邮箱', async () => {
    await createUser({ email: 'a@t.com', name: '甲' });
    await createUser({ email: 'b@t.com', name: '乙', role: 'viewer' });
    const asMember = await identity.listMembers(ctx({ scopes: new Set(['context:read']), human: null }));
    expect(asMember.items.map((u) => u.name)).toEqual(['甲', '乙']);
    expect('email' in asMember.items[0]).toBe(false);
    const asAdmin = await identity.listMembers(ctx({ scopes: new Set(['admin']), human: null }));
    expect(asAdmin.items[0].email).toBe('a@t.com');
  });

  it('handoff_work 转缺陷：assignee + 活动流；viewer 拒绝', async () => {
    const owner = await createUser({ email: 'o@t.com', name: '负责人' });
    const p = await seedProject();
    const bug = await bugsService.createBug({ projectId: p.id, title: '要转交的缺陷' });
    const viewer = await createUser({ email: 'v@t.com', name: '只读', role: 'viewer' });

    await expect(identity.handoffWork(ctx(), { entity_type: 'bug', entity_id: bug.id, assignee_id: viewer.user.id, reason: '你来跟' })).rejects.toThrow(/只读成员/);
    const result = await identity.handoffWork(ctx(), { entity_type: 'bug', entity_id: bug.id, assignee_id: owner.user.id, reason: '你更熟这块' });
    expect(result.assignee.name).toBe('负责人');
    const updated = await bugsService.getBug(bug.id);
    expect(updated.assigneeId).toBe(owner.user.id);
    const comments = await prisma.bugComment.findMany({ where: { bugId: bug.id } });
    expect(comments[0].content).toContain('你更熟这块');
  });

  it('handoff_work 转任务：改负责人；缺 scope 拒绝', async () => {
    const owner = await createUser({ email: 'o@t.com', name: '负责人' });
    const p = await seedProject();
    const task = await tasksService.createTask({ projectId: p.id, title: '要转交的任务' });
    await expect(identity.handoffWork(ctx({ scopes: new Set(['context:read']) }), { entity_type: 'task', entity_id: task.id, assignee_id: owner.user.id, reason: '接手' })).rejects.toThrow(/task:write/);
    const result = await identity.handoffWork(ctx(), { entity_type: 'task', entity_id: task.id, assignee_id: owner.user.id, reason: '接手' });
    expect(result.assignee.name).toBe('负责人');
    expect((await tasksService.getTask(task.id)).assigneeId).toBe(owner.user.id);
  });

  it('handoff_work 原因/负责人校验', async () => {
    const owner = await createUser({ email: 'o@t.com', name: '负责人' });
    const p = await seedProject();
    const bug = await bugsService.createBug({ projectId: p.id, title: '校验' });
    await expect(identity.handoffWork(ctx(), { entity_type: 'bug', entity_id: bug.id, assignee_id: owner.user.id, reason: '   ' })).rejects.toThrow(/原因/);
    await expect(identity.handoffWork(ctx(), { entity_type: 'bug', entity_id: bug.id, assignee_id: 'nope', reason: '转交' })).rejects.toThrow(/不存在/);
  });
});
