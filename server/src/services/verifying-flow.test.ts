import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb, createUser } from '../test-helpers.js';
import * as projectsService from './projects.js';
import * as bugsService from './bugs.js';
import * as tasksService from './tasks.js';
import { isStale, STALE_AFTER_MS } from './stale.js';
import { serializeBug, serializeTask } from '../core/serialize.js';

/**
 * R83（用户决定）：验证的 AI 接手后看不到状态、不知道有没有在干活。
 * ① 缺陷：已解决 → 验证中 → 已验证（终点）；已关闭只留给「重复 / 不修 / 无法复现」，必须写原因；
 * ② 任务：待验证 → 验证中 → 已完成；
 * ③ 每次流转记下「谁、什么时候」，停留过久标为卡住。
 */

beforeEach(async () => {
  await resetDb();
});

async function project() {
  return projectsService.createProject({ name: 'P', slug: 'p' });
}

async function bugAt(status: 'resolved' | 'verifying') {
  const p = await project();
  const bug = await bugsService.createBug({ projectId: p.id, title: '验证流' });
  await bugsService.updateBug(bug.id, { status: 'in_progress' });
  await bugsService.updateBug(bug.id, { status: 'resolved' });
  if (status === 'verifying') await bugsService.updateBug(bug.id, { status: 'verifying' });
  return bug;
}

describe('缺陷：验证中', () => {
  it('主干 已解决 → 验证中 → 已验证，已解决不能直接跳到已验证', async () => {
    const bug = await bugAt('resolved');
    await expect(bugsService.updateBug(bug.id, { status: 'verified' })).rejects.toThrow(
      '不能从「已解决」直接改为「已验证」，可以改为：验证中',
    );
    expect((await bugsService.updateBug(bug.id, { status: 'verifying' })).status).toBe('verifying');
    expect((await bugsService.updateBug(bug.id, { status: 'verified' })).status).toBe('verified');
  });

  it('验证不通过打回要写原因，活动流记「验证不通过」并累计重开次数', async () => {
    const bug = await bugAt('verifying');
    await expect(bugsService.updateBug(bug.id, { status: 'in_progress' })).rejects.toThrow('reopen_reason');
    const back = await bugsService.updateBug(bug.id, { status: 'in_progress', reopenReason: '2.5MB 仍无提示' });
    expect(back.reopenedCount).toBe(1);
    const comments = await prisma.bugComment.findMany({ where: { bugId: bug.id }, orderBy: { createdAt: 'desc' } });
    expect(comments[0].content).toContain('状态变更：验证中 → 进行中');
    expect(comments[0].content).toContain('验证不通过：2.5MB 仍无提示');
  });

  it('验证方放手：验证中 → 已解决 不需要原因（让别的验证方接手）', async () => {
    const bug = await bugAt('verifying');
    expect((await bugsService.updateBug(bug.id, { status: 'resolved' })).status).toBe('resolved');
  });

  it('已验证就是终点：不再往已关闭走，报错说明原因；需要时仍可重开', async () => {
    const bug = await bugAt('verifying');
    await bugsService.updateBug(bug.id, { status: 'verified' });
    await expect(bugsService.updateBug(bug.id, { status: 'closed', resolutionNotes: 'x' })).rejects.toThrow(
      '已验证就是修复完成的终点',
    );
    const reopened = await bugsService.updateBug(bug.id, { status: 'open', reopenReason: '生产又出现' });
    expect(reopened.status).toBe('open');
  });

  it('看板多一列 verifying', async () => {
    const bug = await bugAt('verifying');
    const board = await bugsService.getBugBoard(bug.projectId);
    expect(Object.keys(board)).toEqual(['open', 'in_progress', 'resolved', 'verifying', 'verified', 'closed']);
    expect(board.verifying.map((b) => b.id)).toEqual([bug.id]);
  });

  it('中文状态名含「验证中」', () => {
    expect(bugsService.BUG_STATUS_LABELS.verifying).toBe('验证中');
  });
});

describe('缺陷：已关闭只用于不修复的结局', () => {
  it('关闭必须写原因（resolution_notes），活动流记「关闭原因」', async () => {
    const p = await project();
    const bug = await bugsService.createBug({ projectId: p.id, title: '重复单' });
    await expect(bugsService.updateBug(bug.id, { status: 'closed' })).rejects.toThrow(
      '关闭缺陷需要写明原因（resolution_notes）',
    );
    const closed = await bugsService.updateBug(bug.id, { status: 'closed', resolutionNotes: '重复：bug_abc' });
    expect(closed.status).toBe('closed');
    const comments = await prisma.bugComment.findMany({ where: { bugId: bug.id } });
    expect(comments.map((c) => c.content).join('\n')).toContain('关闭原因：重复：bug_abc');
  });

  it('待处理 / 进行中 / 已解决 都能直接关；验证中不能（先给出验证结论）', async () => {
    const p = await project();
    const a = await bugsService.createBug({ projectId: p.id, title: 'a' });
    await bugsService.updateBug(a.id, { status: 'in_progress' });
    expect((await bugsService.updateBug(a.id, { status: 'closed', resolutionNotes: '不修复：设计如此' })).status).toBe('closed');
    const b = await bugAt('resolved');
    expect((await bugsService.updateBug(b.id, { status: 'closed', resolutionNotes: '无法复现' })).status).toBe('closed');
    const c = await bugAt('verifying');
    await expect(bugsService.updateBug(c.id, { status: 'closed', resolutionNotes: 'x' })).rejects.toThrow('不能从「验证中」');
  });
});

describe('任务：验证中', () => {
  it('待验证 → 验证中 → 已完成；待验证不能直接完成', async () => {
    const p = await project();
    const t = await tasksService.createTask({ projectId: p.id, title: '接入扫码登录' });
    await tasksService.updateTask(t.id, { status: 'doing' });
    await tasksService.updateTask(t.id, { status: 'review' });
    await expect(tasksService.updateTask(t.id, { status: 'done' })).rejects.toThrow(
      '不能从「待验证」直接改为「已完成」，可以改为：验证中',
    );
    expect((await tasksService.updateTask(t.id, { status: 'verifying' })).status).toBe('verifying');
    expect((await tasksService.updateTask(t.id, { status: 'done' })).status).toBe('done');
  });

  it('验证中打回进行中要写原因；放回待验证、取消不需要', async () => {
    const p = await project();
    const t = await tasksService.createTask({ projectId: p.id, title: 't', status: 'doing' });
    await tasksService.updateTask(t.id, { status: 'review' });
    await tasksService.updateTask(t.id, { status: 'verifying' });
    await expect(tasksService.updateTask(t.id, { status: 'doing' })).rejects.toThrow('reopen_reason');
    expect((await tasksService.updateTask(t.id, { status: 'review' })).status).toBe('review');
    await tasksService.updateTask(t.id, { status: 'verifying' });
    const back = await tasksService.updateTask(t.id, { status: 'doing', reopenReason: '回调地址不对' });
    expect(back).toMatchObject({ status: 'doing', reopenReason: '回调地址不对', reopenedCount: 1 });
    expect(tasksService.allowedNextTaskStatuses('verifying')).toEqual(['done', 'doing', 'review', 'cancelled']);
    expect(tasksService.TASK_STATUS_LABELS.verifying).toBe('验证中');
  });
});

describe('谁在处理、从什么时候开始', () => {
  it('缺陷流转记下操作人（用户取名字）与时间；只改字段不刷新', async () => {
    const u = await createUser({ name: '王强' });
    const p = await project();
    const bug = await bugsService.createBug({ projectId: p.id, title: '记录人' });
    const moved = await bugsService.updateBug(bug.id, { status: 'in_progress', actor: { type: 'user', id: u.user.id } });
    expect(moved).toMatchObject({ statusActorType: 'user', statusActorName: '王强' });
    expect(moved.statusChangedAt).toBeInstanceOf(Date);
    const edited = await bugsService.updateBug(bug.id, { title: '改个标题', actor: { type: 'ai', name: 'Cursor-验证' } });
    expect(edited.statusChangedAt?.getTime()).toBe(moved.statusChangedAt?.getTime());
    expect(edited.statusActorName).toBe('王强');
  });

  it('AI 流转记密钥名；序列化带 status_changed_at 与 status_actor', async () => {
    const bug = await bugAt('resolved');
    const v = await bugsService.updateBug(bug.id, { status: 'verifying', actor: { type: 'ai', id: 'key_1', name: 'Cursor-验证' } });
    const json = serializeBug(v);
    expect(json.status_actor).toEqual({ type: 'ai', name: 'Cursor-验证' });
    expect(typeof json.status_changed_at).toBe('string');
  });

  it('任务流转同样记操作人', async () => {
    const p = await project();
    const t = await tasksService.createTask({ projectId: p.id, title: 't' });
    const moved = await tasksService.updateTask(t.id, { status: 'doing' }, { type: 'ai', name: 'Codex' });
    expect(serializeTask(moved).status_actor).toEqual({ type: 'ai', name: 'Codex' });
  });
});

describe('卡住判定', () => {
  const now = new Date('2026-09-24T12:00:00Z');
  const ago = (h: number) => new Date(now.getTime() - h * 3600_000);

  it('验证中超过 2 小时、进行中超过 24 小时算卡住；其他状态不算', () => {
    expect(STALE_AFTER_MS.verifying).toBe(2 * 3600_000);
    expect(isStale('verifying', ago(3), now)).toBe(true);
    expect(isStale('verifying', ago(1), now)).toBe(false);
    expect(isStale('in_progress', ago(25), now)).toBe(true);
    expect(isStale('doing', ago(25), now)).toBe(true);
    expect(isStale('in_progress', ago(5), now)).toBe(false);
    expect(isStale('resolved', ago(100), now)).toBe(false);
    expect(isStale('verifying', null, now)).toBe(false);
  });
});
