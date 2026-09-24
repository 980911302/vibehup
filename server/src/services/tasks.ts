import type { Task, Prisma } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { buildSearchIndex, matchIndex } from '../core/search.js';
import { eventBus } from '../core/events.js';
import { NotFoundError, ValidationError } from '../core/errors.js';
import { countAttachmentsFor } from './attachments.js';

export const TASK_STATUSES = ['todo', 'doing', 'review', 'done', 'cancelled'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待办',
  doing: '进行中',
  review: '待验证',
  done: '已完成',
  cancelled: '已取消',
};

/**
 * 任务状态机（唯一真理源，MCP 侧经 workflow.ts 引用）：
 * 待办 → 进行中 → 待验证 → 已完成 为主干，不能跳级；
 * 待验证/已完成 → 进行中 = 打回（必须写原因）；进行中 → 待办 = 放回；
 * 未完成的任务可取消，已取消只能重新打开回待办。
 */
export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ['doing', 'cancelled'],
  doing: ['review', 'todo', 'cancelled'],
  review: ['done', 'doing', 'cancelled'],
  done: ['doing'],
  cancelled: ['todo'],
};

/** 新建任务允许的初始状态 */
const INITIAL_STATUSES: TaskStatus[] = ['todo', 'doing'];
const MAX_LABELS = 20;
const MAX_LABEL_LENGTH = 32;

export interface TaskWithMeta extends Task {
  attachmentCount: number;
}

export function allowedNextTaskStatuses(status: string): TaskStatus[] {
  return TASK_TRANSITIONS[status as TaskStatus] ?? [];
}

function isReopen(from: TaskStatus, to: TaskStatus): boolean {
  return to === 'doing' && (from === 'review' || from === 'done');
}

function assertStatus(status: string): asserts status is TaskStatus {
  if (!TASK_STATUSES.includes(status as TaskStatus)) {
    throw new ValidationError(`status 必须是 ${TASK_STATUSES.join(' | ')} 之一`);
  }
}

function assertTaskTransition(from: TaskStatus, to: TaskStatus, reason: string): void {
  const allowed = TASK_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new ValidationError(
      `不能从「${TASK_STATUS_LABELS[from]}」直接改为「${TASK_STATUS_LABELS[to]}」，可以改为：${allowed.map((s) => TASK_STATUS_LABELS[s]).join(' / ')}`,
    );
  }
  if (isReopen(from, to) && !reason) {
    throw new ValidationError(`从「${TASK_STATUS_LABELS[from]}」打回「进行中」需要写明原因（reopen_reason），比如验收时发现的问题`);
  }
}

/** 标签归一：去空白、去重、丢空；超长/过多人话拒绝 */
export function normalizeLabels(labels: string[]): string[] {
  const out = [...new Set(labels.map((l) => String(l).trim()).filter(Boolean))];
  if (out.length > MAX_LABELS) throw new ValidationError(`标签最多 ${MAX_LABELS} 个`);
  const tooLong = out.find((l) => l.length > MAX_LABEL_LENGTH);
  if (tooLong) throw new ValidationError(`标签「${tooLong.slice(0, 10)}…」太长，每个标签最多 ${MAX_LABEL_LENGTH} 个字符`);
  return out;
}

function assertPriority(priority?: string): void {
  if (priority && !TASK_PRIORITIES.includes(priority as never)) {
    throw new ValidationError(`priority 必须是 ${TASK_PRIORITIES.join(' | ')} 之一`);
  }
}

export async function createTask(input: {
  projectId: string;
  title: string;
  description?: string | null;
  priority?: string;
  status?: string;
  assigneeId?: string | null;
  labels?: string[];
}): Promise<Task> {
  assertPriority(input.priority);
  if (input.status) {
    assertStatus(input.status);
    if (!INITIAL_STATUSES.includes(input.status)) {
      throw new ValidationError('新建任务的状态只能是 todo 或 doing（待办或进行中）');
    }
  }
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new NotFoundError(`项目不存在: ${input.projectId}`);

  const task = await prisma.task.create({
    data: {
      id: ids.task(),
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'medium',
      status: input.status ?? 'todo',
      assigneeId: input.assigneeId ?? null,
      labels: normalizeLabels(input.labels ?? []),
    },
  });
  eventBus.publish({ type: 'task.created', projectId: task.projectId, taskId: task.id });
  return task;
}

export interface TaskPatch {
  title?: string;
  description?: string | null;
  priority?: string;
  status?: string;
  assigneeId?: string | null;
  labels?: string[];
  /** 打回原因（待验证/已完成 → 进行中 时必填） */
  reopenReason?: string;
}

function buildTaskUpdate(existing: Task, patch: TaskPatch): Prisma.TaskUncheckedUpdateInput {
  assertPriority(patch.priority);
  const data: Prisma.TaskUncheckedUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.assigneeId !== undefined) data.assigneeId = patch.assigneeId;
  if (patch.labels !== undefined) data.labels = normalizeLabels(patch.labels);

  if (patch.status !== undefined) {
    assertStatus(patch.status);
    const from = existing.status as TaskStatus;
    if (patch.status !== from) {
      const reason = patch.reopenReason?.trim() ?? '';
      assertTaskTransition(from, patch.status, reason);
      data.status = patch.status;
      if (isReopen(from, patch.status)) {
        data.reopenReason = reason;
        data.reopenedCount = existing.reopenedCount + 1;
      }
    }
  }
  return data;
}

export async function updateTask(taskId: string, patch: TaskPatch): Promise<Task> {
  const existing = await prisma.task.findUnique({ where: { id: taskId } });
  if (!existing) throw new NotFoundError(`任务不存在: ${taskId}`);
  const task = await prisma.task.update({ where: { id: taskId }, data: buildTaskUpdate(existing, patch) });
  eventBus.publish({
    type: 'task.updated',
    projectId: task.projectId,
    taskId: task.id,
    status: task.status,
  });
  return task;
}

export async function listTasks(query: {
  projectId?: string;
  status?: string;
  priority?: string;
  label?: string;
  q?: string;
} = {}): Promise<TaskWithMeta[]> {
  const where: Prisma.TaskWhereInput = {};
  if (query.projectId) where.projectId = query.projectId;
  if (query.status) where.status = query.status;
  if (query.priority) where.priority = query.priority;
  if (query.label?.trim()) where.labels = { has: query.label.trim() };

  let items = await prisma.task.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  });
  if (query.q?.trim()) {
    const q = query.q.trim();
    items = items.filter((t) =>
      matchIndex(q, buildSearchIndex(t.title, [t.description ?? '', ...t.labels].join(' '))),
    );
  }
  // 附件计数批量取（R78）：一次 groupBy 代替逐条 count
  const counts = await countAttachmentsFor('task', items.map((t) => t.id));
  return items.map((t) => ({ ...t, attachmentCount: counts.get(t.id) ?? 0 }));
}

export async function getTask(taskId: string): Promise<Task> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError(`任务不存在: ${taskId}`);
  return task;
}

/** 任务详情：附件清单一并返回 */
export async function getTaskDetail(taskId: string) {
  const task = await getTask(taskId);
  const attachments = await prisma.attachment.findMany({
    where: { entityType: 'task', entityId: taskId },
    orderBy: { createdAt: 'asc' },
  });
  return { ...task, attachments };
}

/** 负责人 id → 名字（任务表不建外键：存量 assignee_id 可能指向已不存在的用户） */
export async function resolveAssigneeNames(assigneeIds: (string | null)[]): Promise<Map<string, string>> {
  const idsToFind = [...new Set(assigneeIds.filter((x): x is string => Boolean(x)))];
  if (!idsToFind.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: idsToFind } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** 删除任务：挂在任务上的附件转为项目通用附件（文件不丢，可在「文件」页找回） */
export async function deleteTask(taskId: string): Promise<void> {
  const task = await getTask(taskId);
  await prisma.$transaction([
    prisma.attachment.updateMany({
      where: { entityType: 'task', entityId: taskId },
      data: { entityType: 'general', entityId: null },
    }),
    prisma.task.delete({ where: { id: taskId } }),
  ]);
  eventBus.publish({ type: 'task.deleted', projectId: task.projectId, taskId });
}
