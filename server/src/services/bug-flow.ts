import { ValidationError } from '../core/errors.js';

/**
 * 缺陷状态机（唯一真理源；bugs.ts 重导出，MCP 侧经 workflow.ts 引用，前端 web/src/lib/bug-flow.ts 为镜像）。
 *
 * R83（用户决定）：
 * - 主干 待处理 → 进行中 → 已解决 → 验证中 → 已验证，不能跳级；「已验证」就是修复完成的终点；
 * - 验证方接手先改「验证中」，看板上就看得到有人在验；不通过打回（写原因），放手则改回「已解决」；
 * - 「已关闭」只留给不修复的结局（重复 / 不修 / 无法复现），必须写原因，可从待处理、进行中、已解决直接关；
 * - 回流到待处理/进行中（从已解决、验证中、已验证、已关闭）必须写 reopen_reason。
 */
export const BUG_STATUSES = ['open', 'in_progress', 'resolved', 'verifying', 'verified', 'closed'] as const;

export type BugStatus = (typeof BUG_STATUSES)[number];

/** 状态中文名（与看板列名一致；报错与活动流都用它，不直出英文枚举） */
export const BUG_STATUS_LABELS: Record<BugStatus, string> = {
  open: '待处理',
  in_progress: '进行中',
  resolved: '已解决',
  verifying: '验证中',
  verified: '已验证',
  closed: '已关闭',
};

export const bugStatusLabel = (s: string): string => BUG_STATUS_LABELS[s as BugStatus] ?? s;

export const BUG_TRANSITIONS: Record<BugStatus, BugStatus[]> = {
  open: ['in_progress', 'closed'],
  in_progress: ['resolved', 'open', 'closed'],
  resolved: ['verifying', 'in_progress', 'open', 'closed'],
  verifying: ['verified', 'in_progress', 'open', 'resolved'],
  verified: ['in_progress', 'open'],
  closed: ['open'],
};

/** 从这些状态回到待处理/进行中算「重开」，要写原因并累计重开次数 */
const REOPEN_FROM: BugStatus[] = ['resolved', 'verifying', 'verified', 'closed'];

export function isBugReopen(from: string, to: string): boolean {
  return (to === 'open' || to === 'in_progress') && REOPEN_FROM.includes(from as BugStatus);
}

export function assertTransition(
  from: BugStatus,
  to: BugStatus,
  given: { reopenReason?: boolean; closeReason?: boolean } = {},
): void {
  const allowed = BUG_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    const hint = from === 'verified' && to === 'closed' ? '已验证就是修复完成的终点，不用再关闭；' : '';
    throw new ValidationError(
      `${hint}不能从「${bugStatusLabel(from)}」直接改为「${bugStatusLabel(to)}」，可以改为：${allowed.map(bugStatusLabel).join(' / ')}`,
    );
  }
  if (isBugReopen(from, to) && !given.reopenReason) {
    throw new ValidationError(`从「${bugStatusLabel(from)}」重开到「${bugStatusLabel(to)}」需要填写重开原因（reopen_reason）`);
  }
  if (to === 'closed' && !given.closeReason) {
    throw new ValidationError('关闭缺陷需要写明原因（resolution_notes）：重复（写上重复的缺陷号）/ 不修复 / 无法复现');
  }
}

/** 活动流里回流原因的叫法：验证中打回叫「验证不通过」，其余叫「重开原因」 */
export function reopenReasonLabel(from: string): string {
  return from === 'verifying' ? '验证不通过' : '重开原因';
}
