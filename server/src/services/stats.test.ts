import { describe, it, expect } from 'vitest';
import { resolveBugOutcome, resolveTaskOutcome } from './stats.js';

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
