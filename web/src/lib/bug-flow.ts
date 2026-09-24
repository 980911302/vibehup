import type { Bug } from './api-types';
import { BUG_STATUS_LABELS } from './api-types';

/**
 * 缺陷流转（与 server/src/services/bugs.ts 的 BUG_TRANSITIONS 一致）：
 * 待处理 → 进行中 → 已解决 → 已验证 → 已关闭；已解决/已验证/已关闭 回流到待处理/进行中 = 重开，必须写原因。
 */

export type BugStatus = Bug['status'];

export const BUG_STATUSES: BugStatus[] = ['open', 'in_progress', 'resolved', 'verified', 'closed'];

export const BUG_TRANSITIONS: Record<BugStatus, BugStatus[]> = {
  open: ['in_progress'],
  in_progress: ['resolved', 'open'],
  resolved: ['verified', 'closed', 'open', 'in_progress'],
  verified: ['closed', 'open', 'in_progress'],
  closed: ['open'],
};

/** 重开（从已解决/已验证/已关闭回到待处理/进行中）必须写原因 */
export function bugNeedsReopenReason(from: BugStatus, to: BugStatus): boolean {
  return (to === 'open' || to === 'in_progress') && (from === 'resolved' || from === 'verified' || from === 'closed');
}

/** 拖拽能否落到目标列：合法的一步，且重开类要先写原因，所以拖拽不直接重开 */
export function canDropBug(from: BugStatus, to: BugStatus): boolean {
  return from !== to && BUG_TRANSITIONS[from].includes(to) && !bugNeedsReopenReason(from, to);
}

/** 拖到不能放的列时的人话提示 */
export function bugDropRejectReason(from: BugStatus, to: BugStatus): string {
  if (bugNeedsReopenReason(from, to)) return '重开需要写明原因：请点开缺陷，用「重开」操作';
  const allowed = BUG_TRANSITIONS[from].map((s) => BUG_STATUS_LABELS[s]).join(' / ');
  return `「${BUG_STATUS_LABELS[from]}」不能直接到「${BUG_STATUS_LABELS[to]}」，只能改为：${allowed}`;
}

/** 状态按钮文案：同一目标状态，从不同状态过去意思不同 */
export function bugTransitionLabel(from: BugStatus, to: BugStatus): string {
  if (bugNeedsReopenReason(from, to)) return to === 'open' ? '重开' : '重开并继续修';
  if (to === 'open') return '放回待处理';
  if (to === 'in_progress') return '开始处理';
  if (to === 'resolved') return '标记已解决';
  if (to === 'verified') return '验证通过';
  return '关闭';
}

/** 未完成的缺陷才算逾期 */
export function isBugOverdue(bug: Pick<Bug, 'due_date' | 'status'>, now = Date.now()): boolean {
  if (!bug.due_date) return false;
  if (bug.status === 'resolved' || bug.status === 'verified' || bug.status === 'closed') return false;
  return new Date(bug.due_date).getTime() < now;
}
