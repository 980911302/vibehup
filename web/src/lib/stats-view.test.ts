import { describe, it, expect } from 'vitest';
import { sortByActorActivity, scopeParam } from './stats-view';
import type { StatsByActor } from './stats-types';

function row(over: Partial<StatsByActor>): StatsByActor {
  return { type: 'ai', name: 'x', in_hand_bugs: 0, in_hand_tasks: 0, fixed_today: 0, done_today: 0, ...over };
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