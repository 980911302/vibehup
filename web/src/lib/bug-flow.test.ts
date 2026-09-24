import { describe, it, expect } from 'vitest';
import type { Bug, BugBoard } from './api-types';
import { bugDropRejectReason, bugNeedsReopenReason, bugReasonKind, bugTransitionLabel, canDropBug, isBugOverdue } from './bug-flow';
import { activeFilterCount, filterBoard } from './bug-filters';

describe('缺陷流转（前端）', () => {
  it('拖拽只接受合法的下一步，重开类不能直接拖', () => {
    expect(canDropBug('open', 'in_progress')).toBe(true);
    expect(canDropBug('open', 'resolved')).toBe(false);
    expect(canDropBug('resolved', 'verified')).toBe(false);
    expect(canDropBug('resolved', 'verifying')).toBe(true);
    expect(canDropBug('verifying', 'verified')).toBe(true);
    expect(canDropBug('verifying', 'resolved')).toBe(true);
    expect(canDropBug('resolved', 'open')).toBe(false);
    expect(canDropBug('open', 'closed')).toBe(false);
    expect(bugReasonKind('open', 'closed')).toBe('close');
    expect(bugReasonKind('verifying', 'in_progress')).toBe('reopen');
    expect(bugReasonKind('verifying', 'resolved')).toBeNull();
    expect(bugNeedsReopenReason('closed', 'open')).toBe(true);
    expect(bugNeedsReopenReason('in_progress', 'open')).toBe(false);
  });

  it('拒绝原因是人话：列出能去的状态；重开提示去详情写原因', () => {
    expect(bugDropRejectReason('open', 'resolved')).toBe('「待处理」不能直接到「已解决」，只能改为：进行中 / 已关闭');
    expect(bugDropRejectReason('resolved', 'open')).toContain('重开需要写明原因');
    expect(bugDropRejectReason('verifying', 'in_progress')).toContain('验证不通过需要写明原因');
    expect(bugDropRejectReason('open', 'closed')).toContain('关闭需要写明原因');
    expect(bugDropRejectReason('verified', 'closed')).toBe('已验证就是修复完成的终点，不用再关闭');
    expect(bugDropRejectReason('resolved', 'verified')).toBe('「已解决」不能直接到「已验证」，只能改为：验证中 / 进行中 / 待处理 / 已关闭');
  });

  it('按钮文案随来源状态变化', () => {
    expect(bugTransitionLabel('open', 'in_progress')).toBe('开始处理');
    expect(bugTransitionLabel('resolved', 'open')).toBe('重开');
    expect(bugTransitionLabel('in_progress', 'open')).toBe('放回待处理');
    expect(bugTransitionLabel('resolved', 'verifying')).toBe('开始验证');
    expect(bugTransitionLabel('verifying', 'verified')).toBe('验证通过');
    expect(bugTransitionLabel('verifying', 'in_progress')).toBe('验证不通过');
    expect(bugTransitionLabel('verifying', 'resolved')).toBe('放回待验证');
    expect(bugTransitionLabel('open', 'closed')).toBe('关闭（不修复）');
  });

  it('逾期只看未完成的缺陷', () => {
    const past = '2026-01-01T00:00:00Z';
    expect(isBugOverdue({ due_date: past, status: 'open' })).toBe(true);
    expect(isBugOverdue({ due_date: past, status: 'resolved' })).toBe(false);
    expect(isBugOverdue({ due_date: past, status: 'verifying' })).toBe(false);
    expect(isBugOverdue({ due_date: past, status: 'in_progress' })).toBe(true);
    expect(isBugOverdue({ due_date: null, status: 'open' })).toBe(false);
  });
});

describe('看板人员筛选', () => {
  const bug = (id: string, assignee: string | null, reporter: string | null, labels: string[] = []) =>
    ({ id, title: id, assignee_id: assignee, reporter_id: reporter, labels, severity: 'normal' }) as unknown as Bug;
  const board: BugBoard = {
    open: [bug('a', 'me', 'x'), bug('b', 'x', 'me', ['登录']), bug('c', null, 'x')],
    in_progress: [], resolved: [], verifying: [], verified: [], closed: [],
  };
  const ids = (b: BugBoard) => b.open.map((x) => x.id);

  it('指派给我 / 我提的 / 未指派', () => {
    expect(ids(filterBoard(board, { who: 'mine' }, 'me'))).toEqual(['a']);
    expect(ids(filterBoard(board, { who: 'reported' }, 'me'))).toEqual(['b']);
    expect(ids(filterBoard(board, { who: 'unassigned' }, 'me'))).toEqual(['c']);
    expect(ids(filterBoard(board, { who: 'all', label: '登录' }, 'me'))).toEqual(['b']);
  });

  it('生效条件计数（「全部」不算）', () => {
    expect(activeFilterCount({ who: 'all' })).toBe(0);
    expect(activeFilterCount({ who: 'mine', severity: 'high', search: ' ' })).toBe(2);
  });
});
