import { describe, it, expect } from 'vitest';
import {
  sortByActorActivity,
  scopeParam,
  todayDone,
  todayCreated,
  totalRemaining,
  remainingGroups,
  trendTotals,
  trendWeekTotals,
  clockLabel,
  statsDateLabel,
} from './stats-view';
import type { StatsByActor, StatsRemaining, StatsToday, StatsTrendPoint } from './stats-types';

function row(over: Partial<StatsByActor>): StatsByActor {
  return { type: 'ai', name: 'x', in_hand_bugs: 0, in_hand_tasks: 0, fixed_today: 0, done_today: 0, ...over };
}

function today(over: Partial<StatsToday> = {}): StatsToday {
  return { bugs_fixed: 0, bugs_closed_unfixed: 0, tasks_done: 0, bugs_created: 0, tasks_created: 0, ...over };
}

function remaining(
  over: { bugs?: Partial<StatsRemaining['bugs']>; tasks?: Partial<StatsRemaining['tasks']> } = {},
): StatsRemaining {
  return {
    bugs: { unresolved: 0, unverified: 0, urgent: 0, ...over.bugs },
    tasks: { todo: 0, doing: 0, unverified: 0, urgent: 0, ...over.tasks },
  };
}

function point(over: Partial<StatsTrendPoint>): StatsTrendPoint {
  return { date: '2026-11-05', bugs_fixed: 0, tasks_done: 0, ...over };
}

describe('sortByActorActivity', () => {
  it('按总活跃度（手上 + 今天完成）降序', () => {
    const rows = [
      row({ name: 'A', in_hand_bugs: 1 }), // 总量 1
      row({ name: 'B', in_hand_bugs: 2, done_today: 3 }), // 总量 5
      row({ name: 'C', fixed_today: 1 }), // 总量 1
    ];
    const sorted = sortByActorActivity(rows);
    expect(sorted[0].name).toBe('B');
  });

  it('总量相同时按名字排序，结果稳定', () => {
    const rows = [row({ name: '赵六', in_hand_bugs: 1 }), row({ name: '甲', in_hand_bugs: 1 })];
    expect(sortByActorActivity(rows).map((r) => r.name)).toEqual(['甲', '赵六']);
  });

  it('不修改原数组（纯函数）', () => {
    const rows = [row({ name: 'A' }), row({ name: 'B', in_hand_bugs: 1 })];
    const original = [...rows];
    sortByActorActivity(rows);
    expect(rows).toEqual(original);
  });

  it('空数组返回空数组', () => {
    expect(sortByActorActivity([])).toEqual([]);
  });
});

describe('scopeParam', () => {
  it('null 映射为 "all"', () => {
    expect(scopeParam(null)).toBe('all');
  });

  it('有项目 id 时原样透传', () => {
    expect(scopeParam('prj_123')).toBe('prj_123');
  });
});

describe('汇总数字', () => {
  it('今天完成 = 修复完成缺陷 + 完成任务', () => {
    expect(todayDone(today({ bugs_fixed: 2, tasks_done: 3 }))).toBe(5);
  });

  it('今天新增 = 新增缺陷 + 新增任务', () => {
    expect(todayCreated(today({ bugs_created: 4, tasks_created: 1 }))).toBe(5);
  });

  it('还剩多少 = 缺陷两项 + 任务三项', () => {
    expect(totalRemaining(remaining({ bugs: { unresolved: 2, unverified: 3 }, tasks: { todo: 1, doing: 4, unverified: 5 } }))).toBe(15);
  });

  it('两个卡片的分组总数与分段一致，0 也保留分段（用于渲染空条）', () => {
    const groups = remainingGroups(remaining({ bugs: { unresolved: 2, unverified: 1 }, tasks: { todo: 0, doing: 3, unverified: 0 } }));
    expect(groups.map((g) => [g.label, g.total])).toEqual([
      ['缺陷', 3],
      ['任务', 3],
    ]);
    expect(groups[0].segments.map((s) => [s.label, s.count, s.tone])).toEqual([
      ['未解决', 2, 'brand'],
      ['未验证', 1, 'warn'],
    ]);
    expect(groups[1].segments.map((s) => s.count)).toEqual([0, 3, 0]);
  });

  it('趋势合计两系列分别累加，空数组为 0', () => {
    expect(trendTotals([point({ bugs_fixed: 2, tasks_done: 1 }), point({ bugs_fixed: 1, tasks_done: 3 })])).toEqual({
      bugsFixed: 3,
      tasksDone: 4,
    });
    expect(trendTotals([])).toEqual({ bugsFixed: 0, tasksDone: 0 });
  });

  it('趋势近 7 天 / 前 7 天：按顺序切窗，14 条时各 7 条', () => {
    const points = Array.from({ length: 14 }, (_, i) => point({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, bugs_fixed: 1 }));
    expect(trendWeekTotals(points)).toEqual({ last7: 7, prev7: 7 });
    expect(trendWeekTotals([])).toEqual({ last7: 0, prev7: 0 });
  });

  it('刷新时间按北京时间显示时分秒', () => {
    expect(clockLabel(new Date('2026-11-05T12:31:05Z'))).toBe('20:31:05');
  });
});

describe('statsDateLabel', () => {
  it('按北京时间输出月日和星期', () => {
    expect(statsDateLabel('2026-11-05')).toBe('11 月 5 日 · 周四');
  });

  it('非法日期原样返回，不抛错', () => {
    expect(statsDateLabel('not-a-date')).toBe('not-a-date');
  });
});
