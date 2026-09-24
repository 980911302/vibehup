/**
 * 任务流转（与 server/src/services/tasks.ts 的 TASK_TRANSITIONS 一致）：
 * 待办 → 进行中 → 待验证 → 验证中 → 已完成；待验证/验证中/已完成可打回进行中（要写原因）；
 * 验证中可放回待验证（交给别的验证方）；未完成的可取消，取消后可重新打开回待办。
 * 服务端会在任务上返回 allowed_next_statuses，界面优先用它；这里的表只作兜底与列顺序。
 */

export const TASK_STATUSES = ['todo', 'doing', 'review', 'verifying', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待办',
  doing: '进行中',
  review: '待验证',
  verifying: '验证中',
  done: '已完成',
  cancelled: '已取消',
};

export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ['doing', 'cancelled'],
  doing: ['review', 'todo', 'cancelled'],
  review: ['verifying', 'doing', 'cancelled'],
  verifying: ['done', 'doing', 'review', 'cancelled'],
  done: ['doing'],
  cancelled: ['todo'],
};

/** 状态按钮上的动作文案：同一个目标状态，从不同状态过去意思不同 */
export function transitionLabel(from: TaskStatus, to: TaskStatus): string {
  if (to === 'doing' && from === 'todo') return '开始';
  if (to === 'doing') return '打回进行中';
  if (to === 'todo' && from === 'cancelled') return '重新打开';
  if (to === 'todo') return '放回待办';
  if (to === 'review') return from === 'verifying' ? '放回待验证' : '提交验证';
  if (to === 'verifying') return '开始验证';
  if (to === 'done') return '验收通过';
  return '取消任务';
}

/** 打回（待验证/验证中/已完成 → 进行中）必须写原因 */
export function needsReopenReason(from: TaskStatus, to: TaskStatus): boolean {
  return to === 'doing' && (from === 'review' || from === 'verifying' || from === 'done');
}

export function nextStatuses(task: { status: string; allowed_next_statuses?: string[] }): TaskStatus[] {
  const fromServer = task.allowed_next_statuses?.filter((s): s is TaskStatus => (TASK_STATUSES as readonly string[]).includes(s));
  return fromServer ?? TASK_TRANSITIONS[task.status as TaskStatus] ?? [];
}

/** 拖拽能否落到目标列（相邻合法一步，且打回类要先写原因，所以拖拽不直接打回） */
export function canDropTo(from: TaskStatus, to: TaskStatus): boolean {
  return from !== to && TASK_TRANSITIONS[from].includes(to) && !needsReopenReason(from, to);
}
