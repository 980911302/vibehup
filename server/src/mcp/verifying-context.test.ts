import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';
import * as projectsService from '../services/projects.js';
import * as bugsService from '../services/bugs.js';
import * as tasksService from '../services/tasks.js';
import * as mcpTools from './tools.js';
import * as ext from './tools-extended.js';
import { mcpActor, type McpContext } from './context.js';
import { SERVER_INSTRUCTIONS, bugNextStep } from './workflow.js';

/**
 * R83：验证方（通常是另一个 AI）接手后，人和别的 AI 都要看得到「谁在验、验了多久、是不是卡住了」。
 */

beforeEach(async () => {
  await resetDb();
});

const verifier: McpContext = { mode: 'keyed', apiKeyId: 'key_v', scopes: new Set(['admin']), actorLabel: 'Cursor-验证(vhk_1)', actorName: 'Cursor-验证' };

async function resolvedBug(title: string) {
  const p = (await prisma.project.findUnique({ where: { slug: 'ctx' } })) ?? (await projectsService.createProject({ name: 'C', slug: 'ctx' }));
  const bug = await bugsService.createBug({ projectId: p.id, title });
  await bugsService.updateBug(bug.id, { status: 'in_progress' });
  await bugsService.updateBug(bug.id, { status: 'resolved' });
  return bug;
}

describe('MCP：验证中与卡住', () => {
  it('update_bug_status 记下密钥名；get_project_context 列出验证中（谁、从何时）与待验证', async () => {
    const a = await resolvedBug('等验证');
    const b = await resolvedBug('正在验证');
    await mcpTools.updateBugStatus({ bug_id: b.id, status: 'verifying' }, mcpActor(verifier));

    const c = await mcpTools.getProjectContext({ project_slug: 'ctx' });
    expect(c.awaiting_verification.map((x) => x.id)).toEqual([a.id]);
    expect(c.verifying_bugs).toHaveLength(1);
    expect(c.verifying_bugs[0]).toMatchObject({ id: b.id, status: 'verifying', status_actor: 'Cursor-验证' });
    expect(typeof c.verifying_bugs[0].status_changed_at).toBe('string');
    expect(c.summary).toMatchObject({ verifying: 1, stale: 0 });
    expect(c.stale_items).toEqual([]);
  });

  it('验证中超过 2 小时进 stale_items 并提醒；已验证不再算待验证', async () => {
    const b = await resolvedBug('验证方掉线');
    await mcpTools.updateBugStatus({ bug_id: b.id, status: 'verifying' }, mcpActor(verifier));
    await prisma.bug.update({ where: { id: b.id }, data: { statusChangedAt: new Date(Date.now() - 3 * 3600_000) } });
    const done = await resolvedBug('已验完');
    await mcpTools.updateBugStatus({ bug_id: done.id, status: 'verifying' }, mcpActor(verifier));
    await mcpTools.updateBugStatus({ bug_id: done.id, status: 'verified', resolution_notes: '测试环境按步骤复验通过' }, mcpActor(verifier));

    const c = await mcpTools.getProjectContext({ project_slug: 'ctx' });
    expect(c.stale_items.map((x) => [x.id, x.stale])).toEqual([[b.id, true]]);
    expect(c.reminders.join('\n')).toContain('stale_items');
    expect(c.awaiting_verification).toEqual([]);
  });

  it('任务验证中同样带操作人；update_task 记密钥名', async () => {
    const p = await projectsService.createProject({ name: 'T', slug: 'tk' });
    const t = await tasksService.createTask({ projectId: p.id, title: '接入扫码', status: 'doing' });
    await tasksService.updateTask(t.id, { status: 'review' });
    const r = await ext.updateTask(verifier, { task_id: t.id, status: 'verifying' });
    expect(r.allowed_next_statuses).toEqual(['done', 'doing', 'review', 'cancelled']);
    const c = await mcpTools.getProjectContext({ project_slug: 'tk' });
    expect(c.verifying_tasks).toMatchObject([{ id: t.id, status_actor: 'Cursor-验证' }]);
  });

  it('本地无密钥模式记为「本地 AI」', () => {
    expect(mcpActor({ mode: 'local', apiKeyId: null, scopes: new Set(), actorLabel: 'local' }).name).toBe('本地 AI');
  });

  it('下发给 AI 的规则写明「先改 verifying 再验」与「closed 只用于不修复」', () => {
    expect(SERVER_INSTRUCTIONS).toContain('resolved → verifying → verified');
    expect(SERVER_INSTRUCTIONS).toContain('closed 只用于这种不修复的结局');
    expect(bugNextStep('resolved').allowed_next_statuses).toEqual(['verifying', 'in_progress', 'open', 'closed']);
    expect(bugNextStep('verified').next_step).toContain('终点');
  });
});
