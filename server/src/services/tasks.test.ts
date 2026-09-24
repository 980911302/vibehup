import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../core/prisma.js';
import { eventBus, type VibeEvent } from '../core/events.js';
import { resetDb } from '../test-helpers.js';
import * as projectsService from './projects.js';
import * as tasksService from './tasks.js';

/** 任务域：流转（待办 → 进行中 → 待验证 → 验证中 → 已完成，+ 已取消）、标签、删除 */

beforeEach(async () => {
  await resetDb();
});

async function newTask(extra: Partial<Parameters<typeof tasksService.createTask>[0]> = {}) {
  const p = await projectsService.createProject({ name: 'T', slug: `t-${Math.random().toString(36).slice(2, 8)}` });
  return tasksService.createTask({ projectId: p.id, title: '任务', ...extra });
}

describe('任务状态机', () => {
  it('主干逐级推进：todo → doing → review → verifying → done', async () => {
    const t = await newTask();
    expect(t.status).toBe('todo');
    expect((await tasksService.updateTask(t.id, { status: 'doing' })).status).toBe('doing');
    expect((await tasksService.updateTask(t.id, { status: 'review' })).status).toBe('review');
    expect((await tasksService.updateTask(t.id, { status: 'verifying' })).status).toBe('verifying');
    expect((await tasksService.updateTask(t.id, { status: 'done' })).status).toBe('done');
  });

  it('不能跳级，报错用中文状态名并列出可走的下一步', async () => {
    const t = await newTask();
    await expect(tasksService.updateTask(t.id, { status: 'review' })).rejects.toThrow(
      '不能从「待办」直接改为「待验证」，可以改为：进行中 / 已取消',
    );
    await expect(tasksService.updateTask(t.id, { status: 'done' })).rejects.toThrow('不能从「待办」直接改为「已完成」');
    await tasksService.updateTask(t.id, { status: 'doing' });
    await expect(tasksService.updateTask(t.id, { status: 'done' })).rejects.toThrow('不能从「进行中」直接改为「已完成」');
  });

  it('打回（待验证/已完成 → 进行中）必须写原因，记录原因并累计次数', async () => {
    const t = await newTask({ status: 'doing' });
    await tasksService.updateTask(t.id, { status: 'review' });
    await expect(tasksService.updateTask(t.id, { status: 'doing' })).rejects.toThrow('打回');

    const back = await tasksService.updateTask(t.id, { status: 'doing', reopenReason: '  导出按钮在 Safari 不可点  ' });
    expect(back).toMatchObject({ status: 'doing', reopenReason: '导出按钮在 Safari 不可点', reopenedCount: 1 });

    await tasksService.updateTask(t.id, { status: 'review' });
    await tasksService.updateTask(t.id, { status: 'verifying' });
    await tasksService.updateTask(t.id, { status: 'done' });
    const rework = await tasksService.updateTask(t.id, { status: 'doing', reopenReason: '上线后发现漏了分页' });
    expect(rework.reopenedCount).toBe(2);
    expect(rework.reopenReason).toBe('上线后发现漏了分页');
  });

  it('未完成的任务可取消，取消后只能重新打开回待办；已完成不能取消', async () => {
    for (const from of ['todo', 'doing', 'review', 'verifying'] as const) {
      const t = await newTask({ status: from === 'todo' ? 'todo' : 'doing' });
      if (from === 'review' || from === 'verifying') await tasksService.updateTask(t.id, { status: 'review' });
      if (from === 'verifying') await tasksService.updateTask(t.id, { status: 'verifying' });
      expect((await tasksService.updateTask(t.id, { status: 'cancelled' })).status).toBe('cancelled');
      await expect(tasksService.updateTask(t.id, { status: 'doing' })).rejects.toThrow('可以改为：待办');
      expect((await tasksService.updateTask(t.id, { status: 'todo' })).status).toBe('todo');
    }
    const done = await newTask({ status: 'doing' });
    await tasksService.updateTask(done.id, { status: 'review' });
    await tasksService.updateTask(done.id, { status: 'verifying' });
    await tasksService.updateTask(done.id, { status: 'done' });
    await expect(tasksService.updateTask(done.id, { status: 'cancelled' })).rejects.toThrow('不能从「已完成」直接改为「已取消」');
  });

  it('新建只能是待办或进行中；未知状态人话拒绝', async () => {
    await expect(newTask({ status: 'review' })).rejects.toThrow('新建任务的状态只能是 todo 或 doing');
    await expect(newTask({ status: 'blocked' })).rejects.toThrow('status');
    const t = await newTask();
    await expect(tasksService.updateTask(t.id, { status: 'blocked' })).rejects.toThrow('status');
  });

  it('状态不变的 PATCH 不触发流转校验（只改标题等字段）', async () => {
    const t = await newTask();
    const u = await tasksService.updateTask(t.id, { status: 'todo', title: '新标题' });
    expect(u).toMatchObject({ status: 'todo', title: '新标题' });
  });

  it('taskTransitions 给出每个状态可走的下一步', () => {
    expect(tasksService.allowedNextTaskStatuses('todo')).toEqual(['doing', 'cancelled']);
    expect(tasksService.allowedNextTaskStatuses('review')).toEqual(['verifying', 'doing', 'cancelled']);
    expect(tasksService.allowedNextTaskStatuses('verifying')).toEqual(['done', 'doing', 'review', 'cancelled']);
    expect(tasksService.allowedNextTaskStatuses('done')).toEqual(['doing']);
    expect(tasksService.allowedNextTaskStatuses('cancelled')).toEqual(['todo']);
  });
});

describe('任务标签', () => {
  it('新建与修改时去空白、去重、丢弃空标签', async () => {
    const t = await newTask({ labels: [' 前端 ', '前端', '', '登录'] });
    expect(t.labels).toEqual(['前端', '登录']);
    const u = await tasksService.updateTask(t.id, { labels: ['后端', ' 后端'] });
    expect(u.labels).toEqual(['后端']);
  });

  it('标签过长或过多人话拒绝', async () => {
    await expect(newTask({ labels: ['x'.repeat(33)] })).rejects.toThrow('32');
    await expect(newTask({ labels: Array.from({ length: 21 }, (_, i) => `l${i}`) })).rejects.toThrow('20');
  });

  it('列表按标签过滤', async () => {
    const t = await newTask({ labels: ['前端'] });
    await tasksService.createTask({ projectId: t.projectId, title: '别的', labels: ['后端'] });
    const list = await tasksService.listTasks({ projectId: t.projectId, label: '前端' });
    expect(list.map((x) => x.title)).toEqual(['任务']);
  });
});

describe('删除任务', () => {
  it('删除后查不到，并广播 task.deleted', async () => {
    const t = await newTask();
    const events: VibeEvent[] = [];
    const off = eventBus.subscribe((e) => events.push(e));
    await tasksService.deleteTask(t.id);
    off();
    expect(await prisma.task.findUnique({ where: { id: t.id } })).toBeNull();
    expect(events).toContainEqual({ type: 'task.deleted', projectId: t.projectId, taskId: t.id });
    await expect(tasksService.deleteTask(t.id)).rejects.toThrow('任务不存在');
  });

  it('删除时把挂在任务上的附件转为项目通用附件（文件不丢）', async () => {
    const t = await newTask();
    await prisma.attachment.create({
      data: {
        id: 'att_task_1', projectId: t.projectId, entityType: 'task', entityId: t.id,
        fileName: 'a.log', fileType: 'text/plain', fileSize: 1, storagePath: 'x/a.log',
      },
    });
    await tasksService.deleteTask(t.id);
    expect(await prisma.attachment.findUnique({ where: { id: 'att_task_1' } })).toMatchObject({
      entityType: 'general',
      entityId: null,
    });
  });
});
