import { describe, it, expect, beforeEach } from 'vitest';
import { resolveBugOutcome, resolveTaskOutcome } from './stats.js';
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';
import { getStats } from './stats.js';

const NOW = new Date('2026-09-25T04:00:00.000Z');

describe('resolveBugOutcome', () => {
  it('verified 且有 statusChangedAt：fixed，用该时间与经手人', () => {
    const r = resolveBugOutcome(
      { status: 'verified', statusChangedAt: NOW, statusActorType: 'ai', statusActorName: 'zhanglinlin-trial', updatedAt: NOW },
      null,
    );
    expect(r).toEqual({ kind: 'fixed', at: NOW, actor: { type: 'ai', name: 'zhanglinlin-trial' } });
  });

  it('closed 且有 statusChangedAt：直接判 closed_unfixed（R83 起 verified 不能直接关闭，无需看来源）', () => {
    const r = resolveBugOutcome(
      { status: 'closed', statusChangedAt: NOW, statusActorType: 'user', statusActorName: '张三', updatedAt: NOW },
      null,
    );
    expect(r).toEqual({ kind: 'closed_unfixed', at: NOW, actor: { type: 'user', name: '张三' } });
  });

  it('verified 且无 statusChangedAt：回退用 legacy 的时间与经手人', () => {
    const legacyAt = new Date('2026-09-20T10:00:00.000Z');
    const r = resolveBugOutcome(
      { status: 'verified', statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW },
      { from: 'verifying', at: legacyAt, actor: { type: 'ai', name: 'old-key' } },
    );
    expect(r).toEqual({ kind: 'fixed', at: legacyAt, actor: { type: 'ai', name: 'old-key' } });
  });

  it('closed 且无 statusChangedAt，legacy.from = verified：老流程「验证完关闭」算 fixed', () => {
    const legacyAt = new Date('2026-09-20T10:00:00.000Z');
    const r = resolveBugOutcome(
      { status: 'closed', statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW },
      { from: 'verified', at: legacyAt, actor: { type: 'ai', name: 'zhanglinlin-trial' } },
    );
    expect(r).toEqual({ kind: 'fixed', at: legacyAt, actor: { type: 'ai', name: 'zhanglinlin-trial' } });
  });

  it('closed 且无 statusChangedAt，legacy.from ≠ verified：closed_unfixed（不修/重复）', () => {
    const legacyAt = new Date('2026-09-20T10:00:00.000Z');
    const r = resolveBugOutcome(
      { status: 'closed', statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW },
      { from: 'open', at: legacyAt, actor: { type: 'user', name: '李四' } },
    );
    expect(r).toEqual({ kind: 'closed_unfixed', at: legacyAt, actor: { type: 'user', name: '李四' } });
  });

  it('closed 且无 statusChangedAt、无 legacy（连评论都没有的远古数据）：closed_unfixed，用 updatedAt，经手人 null', () => {
    const r = resolveBugOutcome(
      { status: 'closed', statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW },
      null,
    );
    expect(r).toEqual({ kind: 'closed_unfixed', at: NOW, actor: null });
  });

  it('statusActorType 有值但 statusActorName 为空字符串：actor.name 兜底空串（不是 null）', () => {
    const r = resolveBugOutcome(
      { status: 'verified', statusChangedAt: NOW, statusActorType: 'ai', statusActorName: null, updatedAt: NOW },
      null,
    );
    expect(r?.actor).toEqual({ type: 'ai', name: '' });
  });

  it.each(['open', 'in_progress', 'resolved', 'verifying'])('%s 状态还没到终态，返回 null', (status) => {
    expect(resolveBugOutcome({ status, statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW }, null)).toBeNull();
  });
});

describe('resolveTaskOutcome', () => {
  it('done 且有 statusChangedAt：用该时间与经手人', () => {
    const r = resolveTaskOutcome({ status: 'done', statusChangedAt: NOW, statusActorType: 'ai', statusActorName: 'zhanglinlin-trial', updatedAt: NOW });
    expect(r).toEqual({ at: NOW, actor: { type: 'ai', name: 'zhanglinlin-trial' } });
  });

  it('done 且无 statusChangedAt：回退 updatedAt，经手人 null（任务没有活动流可查，未记录）', () => {
    const r = resolveTaskOutcome({ status: 'done', statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW });
    expect(r).toEqual({ at: NOW, actor: null });
  });

  it.each(['todo', 'doing', 'review', 'verifying', 'cancelled'])('%s 状态不是「已完成」，返回 null', (status) => {
    expect(resolveTaskOutcome({ status, statusChangedAt: null, statusActorType: null, statusActorName: null, updatedAt: NOW })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Task 4：getStats 集成用例（真连测试库）
// ─────────────────────────────────────────────────────────────

const T = (iso: string) => new Date(iso);
/**
 * 夹具默认时间戳（固定旧日期）：不能让 createdAt/updatedAt 回落到真实 `new Date()`——
 * 真实「今天」会和用例里 mock 的 `now` 撞在同一天（本机运行日就是 2026-09-25），
 * 默认值一旦落在 today 窗口，计数会随运行日期漂移。想表达「今天」必须显式传时间。
 */
const FIXED_TS = T('2026-09-01T00:00:00.000Z');

async function makeProject(id: string, name: string) {
  return prisma.project.create({ data: { id, name, slug: `${id}-slug` } });
}

async function makeBug(over: Partial<{
  id: string; projectId: string; title: string; status: string;
  statusChangedAt: Date | null; statusActorType: string | null; statusActorName: string | null;
  createdAt: Date; updatedAt: Date;
}>) {
  return prisma.bug.create({
    data: {
      id: over.id!, projectId: over.projectId!, title: over.title ?? '测试缺陷',
      status: over.status ?? 'open',
      statusChangedAt: over.statusChangedAt ?? null,
      statusActorType: over.statusActorType ?? null,
      statusActorName: over.statusActorName ?? null,
      createdAt: over.createdAt ?? FIXED_TS,
      updatedAt: over.updatedAt ?? FIXED_TS,
    },
  });
}

async function makeTask(over: Partial<{
  id: string; projectId: string; title: string; status: string;
  statusChangedAt: Date | null; statusActorType: string | null; statusActorName: string | null;
  createdAt: Date; updatedAt: Date;
}>) {
  return prisma.task.create({
    data: {
      id: over.id!, projectId: over.projectId!, title: over.title ?? '测试任务',
      status: over.status ?? 'todo',
      statusChangedAt: over.statusChangedAt ?? null,
      statusActorType: over.statusActorType ?? null,
      statusActorName: over.statusActorName ?? null,
      createdAt: over.createdAt ?? FIXED_TS,
      updatedAt: over.updatedAt ?? FIXED_TS,
    },
  });
}

describe('getStats（集成，真连测试库）', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('今天修复完成 / 完成任务 / 新增：按北京日界线精确计数', async () => {
    const p = await makeProject('prj_s1', '统计项目');
    const now = T('2026-09-25T04:00:00.000Z'); // 北京 2026-09-25 12:00
    // 今天 00:00 北京 = 2026-09-24T16:00:00Z；今天验证完成的缺陷
    await makeBug({ id: 'bug_s1', projectId: p.id, status: 'verified', statusChangedAt: T('2026-09-24T16:00:00.000Z'), statusActorType: 'ai', statusActorName: 'zhanglinlin-trial' });
    // 昨天（日界线前 1ms）验证完成的缺陷：不算今天
    await makeBug({ id: 'bug_s2', projectId: p.id, status: 'verified', statusChangedAt: T('2026-09-24T15:59:59.999Z'), statusActorType: 'ai', statusActorName: 'k' });
    // 今天不修关闭的缺陷
    await makeBug({ id: 'bug_s3', projectId: p.id, status: 'closed', statusChangedAt: T('2026-09-25T01:00:00.000Z'), statusActorType: 'user', statusActorName: '王五' });
    // 今天新建的缺陷（还 open）：显式落在北京今天窗口内（日界线前后各一条，验证半开区间）
    await makeBug({ id: 'bug_s4', projectId: p.id, status: 'open', createdAt: T('2026-09-24T16:00:00.000Z') }); // 北京 09-25 00:00
    await makeBug({ id: 'bug_s5', projectId: p.id, status: 'open', createdAt: T('2026-09-24T17:00:00.000Z') }); // 北京 09-25 01:00
    // 今天完成的任务
    await makeTask({ id: 'tsk_s1', projectId: p.id, status: 'done', statusChangedAt: T('2026-09-25T02:00:00.000Z'), statusActorType: 'ai', statusActorName: 'zhanglinlin-trial' });
    // 今天新建的任务
    await makeTask({ id: 'tsk_s2', projectId: p.id, status: 'todo', createdAt: T('2026-09-25T03:00:00.000Z') });
    await makeTask({ id: 'tsk_s3', projectId: p.id, status: 'todo', createdAt: T('2026-09-24T16:30:00.000Z') }); // 北京 09-25 00:30

    const r = await getStats({ projectId: p.id }, now);
    expect(r.scope).toEqual({ project_id: p.id, today: '2026-09-25', timezone: 'Asia/Shanghai', days: 14 });
    expect(r.today).toEqual({ bugs_fixed: 1, bugs_closed_unfixed: 1, tasks_done: 1, bugs_created: 2, tasks_created: 2 });
  });

  it('还剩多少：三个桶分类正确，cancelled 任务不计入任何剩余桶', async () => {
    const p = await makeProject('prj_s2', '剩余项目');
    await makeBug({ id: 'bug_r1', projectId: p.id, status: 'open' });
    await makeBug({ id: 'bug_r2', projectId: p.id, status: 'in_progress' });
    await makeBug({ id: 'bug_r3', projectId: p.id, status: 'resolved' });
    await makeBug({ id: 'bug_r4', projectId: p.id, status: 'verifying' });
    await makeTask({ id: 'tsk_r1', projectId: p.id, status: 'todo' });
    await makeTask({ id: 'tsk_r2', projectId: p.id, status: 'doing' });
    await makeTask({ id: 'tsk_r3', projectId: p.id, status: 'review' });
    await makeTask({ id: 'tsk_r4', projectId: p.id, status: 'verifying' });
    await makeTask({ id: 'tsk_r5', projectId: p.id, status: 'cancelled' });

    const r = await getStats({ projectId: p.id }, new Date());
    expect(r.remaining).toEqual({
      bugs: { unresolved: 2, unverified: 2 },
      tasks: { todo: 1, doing: 1, unverified: 2 },
    });
  });

  it('active：只含处理中/等验证的条目，排序为「卡住的在前，其余按停留时长降序」', async () => {
    const p = await makeProject('prj_s3', '活跃项目');
    const now = T('2026-09-25T10:00:00.000Z');
    // 进行中，卡了 30 小时（超 24h 阈值）
    await makeBug({ id: 'bug_a1', projectId: p.id, title: '卡住的缺陷', status: 'in_progress', statusChangedAt: T('2026-09-24T04:00:00.000Z'), statusActorType: 'ai', statusActorName: 'k1' });
    // 进行中，才 1 小时
    await makeBug({ id: 'bug_a2', projectId: p.id, title: '刚开始的缺陷', status: 'in_progress', statusChangedAt: T('2026-09-25T09:00:00.000Z'), statusActorType: 'ai', statusActorName: 'k1' });
    // 已解决（等验证），停了 5 小时——待验证类无阈值，不该标 stale
    await makeBug({ id: 'bug_a3', projectId: p.id, title: '等验证的缺陷', status: 'resolved', statusChangedAt: T('2026-09-25T05:00:00.000Z'), statusActorType: 'user', statusActorName: '甲' });
    // 已验证：不在 active 里
    await makeBug({ id: 'bug_a4', projectId: p.id, title: '已验证不显示', status: 'verified', statusChangedAt: now });
    // 已取消任务：不在 active 里
    await makeTask({ id: 'tsk_a1', projectId: p.id, title: '已取消不显示', status: 'cancelled', statusChangedAt: now });

    const r = await getStats({ projectId: p.id }, now);
    expect(r.active.map((a) => a.title)).toEqual(['卡住的缺陷', '等验证的缺陷', '刚开始的缺陷']);
    expect(r.active.find((a) => a.title === '卡住的缺陷')?.stale).toBe(true);
    expect(r.active.find((a) => a.title === '等验证的缺陷')?.stale).toBe(false);
    expect(r.active.find((a) => a.title === '刚开始的缺陷')?.stale).toBe(false);
  });

  it('by_actor：手上不含 resolved/review，今天完成数按人归集，全 0 的不出现', async () => {
    const p = await makeProject('prj_s4', '经手人项目');
    const now = T('2026-09-25T10:00:00.000Z');
    await makeBug({ id: 'bug_b1', projectId: p.id, status: 'in_progress', statusChangedAt: now, statusActorType: 'ai', statusActorName: 'zhanglinlin-trial' });
    // resolved：不计入 in_hand_bugs（虽然出现在 active 里）
    await makeBug({ id: 'bug_b2', projectId: p.id, status: 'resolved', statusChangedAt: now, statusActorType: 'ai', statusActorName: 'zhanglinlin-trial' });
    await makeBug({ id: 'bug_b3', projectId: p.id, status: 'verified', statusChangedAt: now, statusActorType: 'ai', statusActorName: 'zhanglinlin-trial' });
    await makeTask({ id: 'tsk_b1', projectId: p.id, status: 'doing', statusChangedAt: now, statusActorType: 'ai', statusActorName: 'zhanglinlin-trial' });
    // 另一个人，只完成了一个任务
    await makeTask({ id: 'tsk_b2', projectId: p.id, status: 'done', statusChangedAt: now, statusActorType: 'user', statusActorName: '赵六' });

    const r = await getStats({ projectId: p.id }, now);
    const byName = new Map(r.by_actor.map((a) => [a.name, a]));
    expect(byName.get('zhanglinlin-trial')).toEqual({ type: 'ai', name: 'zhanglinlin-trial', in_hand_bugs: 1, in_hand_tasks: 1, fixed_today: 1, done_today: 0 });
    expect(byName.get('赵六')).toEqual({ type: 'user', name: '赵六', in_hand_bugs: 0, in_hand_tasks: 0, fixed_today: 0, done_today: 1 });
    expect(r.by_actor).toHaveLength(2); // 没有全 0 的第三行
  });

  it('trend：14 条，旧→新，最后一条含今天新算出的完成数', async () => {
    const p = await makeProject('prj_s5', '趋势项目');
    const now = T('2026-09-25T10:00:00.000Z');
    await makeBug({ id: 'bug_t1', projectId: p.id, status: 'verified', statusChangedAt: now });
    await makeTask({ id: 'tsk_t1', projectId: p.id, status: 'done', statusChangedAt: now });

    const r = await getStats({ projectId: p.id }, now);
    expect(r.trend).toHaveLength(14);
    expect(r.trend[13]).toEqual({ date: '2026-09-25', bugs_fixed: 1, tasks_done: 1 });
    expect(r.trend[0].date).toBe('2026-09-12');
    expect(r.trend[0]).toEqual({ date: '2026-09-12', bugs_fixed: 0, tasks_done: 0 });
  });

  it('项目范围：projectId=null 聚合全部项目；指定 projectId 只看该项目', async () => {
    const p1 = await makeProject('prj_s6a', '项目甲');
    const p2 = await makeProject('prj_s6b', '项目乙');
    const now = T('2026-09-25T10:00:00.000Z');
    await makeBug({ id: 'bug_c1', projectId: p1.id, status: 'verified', statusChangedAt: now });
    await makeBug({ id: 'bug_c2', projectId: p2.id, status: 'verified', statusChangedAt: now });

    const all = await getStats({ projectId: null }, now);
    expect(all.today.bugs_fixed).toBe(2);
    expect(all.scope.project_id).toBeNull();

    const onlyP1 = await getStats({ projectId: p1.id }, now);
    expect(onlyP1.today.bugs_fixed).toBe(1);
    expect(onlyP1.scope.project_id).toBe(p1.id);
  });

  it('老数据兜底：statusChangedAt 为空的 closed 缺陷，靠最后一条状态变更评论判定 fixed/closed_unfixed', async () => {
    const p = await makeProject('prj_s7', '老数据项目');
    const now = T('2026-09-25T10:00:00.000Z');
    const fixedBug = await makeBug({ id: 'bug_l1', projectId: p.id, status: 'closed', statusChangedAt: null, updatedAt: now });
    await prisma.bugComment.create({
      data: { id: 'bc_l1', bugId: fixedBug.id, authorType: 'ai', authorId: null, content: '状态变更：已验证 → 已关闭', createdAt: T('2026-09-25T02:00:00.000Z') },
    });
    const unfixedBug = await makeBug({ id: 'bug_l2', projectId: p.id, status: 'closed', statusChangedAt: null, updatedAt: now });
    await prisma.bugComment.create({
      data: { id: 'bc_l2', bugId: unfixedBug.id, authorType: 'user', authorId: null, content: '状态变更：待处理 → 已关闭', createdAt: T('2026-09-25T03:00:00.000Z') },
    });

    const r = await getStats({ projectId: p.id }, now);
    expect(r.today.bugs_fixed).toBe(1);
    expect(r.today.bugs_closed_unfixed).toBe(1);
  });

  it('老数据经手人：AI 评论的 authorId 是密钥 id，能查到就用密钥名，密钥已不存在则经手人为 null', async () => {
    const p = await makeProject('prj_s8', '密钥回溯项目');
    const now = T('2026-09-25T10:00:00.000Z');
    const key = await prisma.apiKey.create({ data: { id: 'key_l1', name: 'old-cursor-key', keyPrefix: 'vhk_test_old1', keyHash: 'h', salt: 's' } });
    const bugWithKey = await makeBug({ id: 'bug_l3', projectId: p.id, status: 'verified', statusChangedAt: null, updatedAt: now });
    await prisma.bugComment.create({ data: { id: 'bc_l3', bugId: bugWithKey.id, authorType: 'ai', authorId: key.id, content: '状态变更：验证中 → 已验证', createdAt: now } });
    const bugDanglingKey = await makeBug({ id: 'bug_l4', projectId: p.id, status: 'verified', statusChangedAt: null, updatedAt: now });
    await prisma.bugComment.create({ data: { id: 'bc_l4', bugId: bugDanglingKey.id, authorType: 'ai', authorId: 'key_deleted_long_ago', content: '状态变更：验证中 → 已验证', createdAt: now } });

    const r = await getStats({ projectId: p.id }, now);
    // verified 不在 active 里，改从 by_actor 断言
    expect(r.by_actor.find((a) => a.name === 'old-cursor-key')?.fixed_today).toBe(1);
    // 找不到密钥名的那条不会污染任何 by_actor 行（actor=null 不计入任何人）
    expect(r.by_actor.every((a) => a.name !== 'key_deleted_long_ago')).toBe(true);
  });
});
