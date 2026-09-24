import type { Bug } from './api-types';
import { BUG_STATUS_LABELS } from './api-types';

/**
 * 缺陷流转（与 server/src/services/bug-flow.ts 的 BUG_TRANSITIONS 一致）：
 * 待处理 → 进行中 → 已解决 → 验证中 → 已验证（修复完成的终点）；
 * 回流到待处理/进行中（从已解决/验证中/已验证/已关闭）= 重开，必须写原因；
 * 已关闭只用于重复 / 不修 / 无法复现，必须写原因，可从待处理、进行中、已解决直接关。
 */

export type BugStatus = Bug['status'];

export const BUG_STATUSES: BugStatus[] = ['open', 'in_progress', 'resolved', 'verifying', 'verified', 'closed'];

export const BUG_TRANSITIONS: Record<BugStatus, BugStatus[]> = {
  open: ['in_progress', 'closed'],
  in_progress: ['resolved', 'open', 'closed'],
  resolved: ['verifying', 'in_progress', 'open', 'closed'],
  verifying: ['verified', 'in_progress', 'open', 'resolved'],
  verified: ['in_progress', 'open'],
  closed: ['open'],
};

const REOPEN_FROM: BugStatus[] = ['resolved', 'verifying', 'verified', 'closed'];

/** 这一步要不要写原因：重开（reopen_reason）或关闭（resolution_notes） */
export function bugReasonKind(from: BugStatus, to: BugStatus): 'reopen' | 'close' | null {
  if (to === 'closed') return 'close';
  if ((to === 'open' || to === 'in_progress') && REOPEN_FROM.includes(from)) return 'reopen';
  return null;
}

export function bugNeedsReopenReason(from: BugStatus, to: BugStatus): boolean {
  return bugReasonKind(from, to) === 'reopen';
}

/** 拖拽能否落到目标列：合法的一步，且不需要写原因（要写原因的去详情里操作） */
export function canDropBug(from: BugStatus, to: BugStatus): boolean {
  return from !== to && BUG_TRANSITIONS[from].includes(to) && bugReasonKind(from, to) === null;
}

/** 拖到不能放的列时的人话提示 */
export function bugDropRejectReason(from: BugStatus, to: BugStatus): string {
  if (from === 'verified' && to === 'closed') return '已验证就是修复完成的终点，不用再关闭';
  if (BUG_TRANSITIONS[from].includes(to)) {
    const kind = bugReasonKind(from, to);
    if (kind === 'close') return '关闭需要写明原因（重复 / 不修复 / 无法复现）：请点开缺陷，用「关闭」操作';
    if (kind === 'reopen') {
      return from === 'verifying'
        ? '验证不通过需要写明原因：请点开缺陷，用「验证不通过」操作'
        : '重开需要写明原因：请点开缺陷，用「重开」操作';
    }
  }
  const allowed = BUG_TRANSITIONS[from].map((s) => BUG_STATUS_LABELS[s]).join(' / ');
  return `「${BUG_STATUS_LABELS[from]}」不能直接到「${BUG_STATUS_LABELS[to]}」，只能改为：${allowed}`;
}

/** 状态按钮文案：同一目标状态，从不同状态过去意思不同 */
export function bugTransitionLabel(from: BugStatus, to: BugStatus): string {
  if (from === 'verifying' && to === 'in_progress') return '验证不通过';
  if (from === 'verifying' && to === 'open') return '打回待处理';
  if (from === 'verifying' && to === 'resolved') return '放回待验证';
  if (bugNeedsReopenReason(from, to)) return to === 'open' ? '重开' : '重开并继续修';
  if (to === 'open') return '放回待处理';
  if (to === 'in_progress') return '开始处理';
  if (to === 'resolved') return '标记已解决';
  if (to === 'verifying') return '开始验证';
  if (to === 'verified') return '验证通过';
  return '关闭（不修复）';
}

/** 未修完的缺陷才算逾期（已解决之后都在验证或已结束） */
export function isBugOverdue(bug: Pick<Bug, 'due_date' | 'status'>, now = Date.now()): boolean {
  if (!bug.due_date) return false;
  if (bug.status !== 'open' && bug.status !== 'in_progress') return false;
  return new Date(bug.due_date).getTime() < now;
}
