import { describe, it, expect } from 'vitest';
import { beijingDayBounds, beijingTrendDays, BEIJING_OFFSET_MS } from './stats-time.js';

describe('beijingDayBounds', () => {
  it('UTC 16:00 = 北京次日 00:00：跨过日界线', () => {
    // 2026-09-24T16:00:00Z = 2026-09-25T00:00:00+08:00（北京刚进入 25 号）
    const r = beijingDayBounds(new Date('2026-09-24T16:00:00.000Z'));
    expect(r.dateStr).toBe('2026-09-25');
    expect(r.start.toISOString()).toBe('2026-09-24T16:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-09-25T16:00:00.000Z');
  });

  it('UTC 15:59:59.999 仍算北京当天（还没跨过日界线）', () => {
    const r = beijingDayBounds(new Date('2026-09-24T15:59:59.999Z'));
    expect(r.dateStr).toBe('2026-09-24');
  });

  it('端点包含关系：start 落在区间内，end 不落在区间内（半开区间）', () => {
    const now = new Date('2026-09-25T03:00:00.000Z');
    const r = beijingDayBounds(now);
    expect(r.start.getTime() <= now.getTime()).toBe(true);
    expect(now.getTime() < r.end.getTime()).toBe(true);
    expect(r.end.getTime() - r.start.getTime()).toBe(86_400_000);
  });

  it('偏移量恒为 8 小时', () => {
    expect(BEIJING_OFFSET_MS).toBe(8 * 3600_000);
  });
});

describe('beijingTrendDays', () => {
  it('返回 days 条，旧→新，最后一条是 now 所在的北京日', () => {
    const now = new Date('2026-09-25T03:00:00.000Z'); // 北京 2026-09-25 11:00
    const days = beijingTrendDays(now, 14);
    expect(days).toHaveLength(14);
    expect(days[13].dateStr).toBe('2026-09-25');
    expect(days[0].dateStr).toBe('2026-09-12'); // 25 号往前数 13 天
  });

  it('相邻两天首尾相接（end[i] === start[i+1]）', () => {
    const days = beijingTrendDays(new Date('2026-09-25T03:00:00.000Z'), 5);
    for (let i = 0; i < days.length - 1; i++) {
      expect(days[i].end.getTime()).toBe(days[i + 1].start.getTime());
    }
  });
});
