import { describe, it, expect } from 'vitest';
import { canDropTo, needsReopenReason, nextStatuses, transitionLabel } from './task-flow';
import { pickInitialProject } from './current-project';

describe('任务五态（前端）', () => {
  it('优先用服务端给的下一步，缺省时按本地流转表', () => {
    expect(nextStatuses({ status: 'todo' })).toEqual(['doing', 'cancelled']);
    expect(nextStatuses({ status: 'review', allowed_next_statuses: ['done'] })).toEqual(['done']);
  });

  it('打回要写原因，拖拽不直接打回、不能跳级', () => {
    expect(needsReopenReason('review', 'doing')).toBe(true);
    expect(needsReopenReason('todo', 'doing')).toBe(false);
    expect(canDropTo('todo', 'doing')).toBe(true);
    expect(canDropTo('todo', 'review')).toBe(false);
    expect(canDropTo('review', 'doing')).toBe(false);
    expect(canDropTo('doing', 'doing')).toBe(false);
  });

  it('按钮文案随来源状态变化', () => {
    expect(transitionLabel('todo', 'doing')).toBe('开始');
    expect(transitionLabel('review', 'doing')).toBe('打回进行中');
    expect(transitionLabel('cancelled', 'todo')).toBe('重新打开');
    expect(transitionLabel('doing', 'review')).toBe('提交验证');
  });
});

describe('当前项目恢复', () => {
  const list = [
    { id: 'a', archived_at: '2026-01-01' },
    { id: 'b', archived_at: null },
    { id: 'c' },
  ];
  it('记住的项目仍在且未归档就用它，否则回落第一个未归档项目', () => {
    expect(pickInitialProject(list, 'c')).toBe('c');
    expect(pickInitialProject(list, 'a')).toBe('b');
    expect(pickInitialProject(list, 'gone')).toBe('b');
    expect(pickInitialProject(list, null)).toBe('b');
    expect(pickInitialProject([], 'x')).toBeNull();
    expect(pickInitialProject([{ id: 'only', archived_at: 'x' }], null)).toBe('only');
  });
});
