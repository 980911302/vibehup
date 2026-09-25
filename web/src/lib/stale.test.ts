import { describe, it, expect } from 'vitest';
import { formatSpan, handlingOf, isHandlingStatus } from './stale';

describe('谁在处理 · 多久 · 是否卡住（R83）', () => {
  const now = new Date('2026-09-24T12:00:00Z').getTime();
  const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
  const item = (status: string, hours: number, actor: { type: 'user' | 'ai'; name: string } | null = null) => ({
    status, status_changed_at: ago(hours), status_actor: actor, updated_at: ago(0),
  });

  it('只有处理中的状态才显示', () => {
    expect(isHandlingStatus('verifying')).toBe(true);
    expect(isHandlingStatus('doing')).toBe(true);
    expect(handlingOf(item('resolved', 5), now)).toBeNull();
    expect(handlingOf(item('verified', 5), now)).toBeNull();
  });

  it('验证中超过 2 小时算卡住；进行中 24 小时内不算', () => {
    const ai = { type: 'ai' as const, name: 'Cursor-验证' };
    expect(handlingOf(item('verifying', 1, ai), now)).toEqual({ actor: ai, span: '1 小时', stale: false });
    expect(handlingOf(item('verifying', 3, ai), now)).toMatchObject({ span: '3 小时', stale: true });
    expect(handlingOf(item('in_progress', 5), now)?.stale).toBe(false);
    expect(handlingOf(item('in_progress', 30), now)).toMatchObject({ span: '30 小时', stale: true });
  });

  it('历史数据没有流转时间时用 updated_at 近似', () => {
    const h = handlingOf({ status: 'doing', status_changed_at: null, status_actor: null, updated_at: ago(50) }, now);
    expect(h).toEqual({ actor: null, span: '2 天', stale: true });
  });

  it('时长写成人话', () => {
    expect(formatSpan(20_000)).toBe('刚刚');
    expect(formatSpan(12 * 60_000)).toBe('12 分钟');
    expect(formatSpan(3 * 3600_000)).toBe('3 小时');
    expect(formatSpan(72 * 3600_000)).toBe('3 天');
  });
});
