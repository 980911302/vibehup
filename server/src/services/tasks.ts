import type { Task, Prisma } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { buildSearchIndex, matchIndex } from '../core/search.js';
import { eventBus } from '../core/events.js';
import { NotFoundError, ValidationError } from '../core/errors.js';
import { countAttachments } from './attachments.js';

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;

export interface TaskWithMeta extends Task {
  attachmentCount: number;
}

export async function createTask(input: {
  projectId: string;
  title: string;
  description?: string | null;
  priority?: string;
  assigneeId?: string | null;
}): Promise<Task> {
  if (input.priority && !TASK_PRIORITIES.includes(input.priority as never)) {
    throw new ValidationError(`priority 必须是 ${TASK_PRIORITIES.join(' | ')} 之一`);
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
      assigneeId: input.assigneeId ?? null,
    },
  });
  eventBus.publish({ type: 'task.created', projectId: task.projectId, taskId: task.id });
  return task;
}

export async function updateTask(
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    priority?: string;
    status?: string;
    assigneeId?: string | null;
  },
): Promise<Task> {
  const existing = await prisma.task.findUnique({ where: { id: taskId } });
  if (!existing) throw new NotFoundError(`任务不存在: ${taskId}`);
  if (patch.status && !TASK_STATUSES.includes(patch.status as never)) {
    throw new ValidationError(`status 必须是 ${TASK_STATUSES.join(' | ')} 之一`);
  }
  if (patch.priority && !TASK_PRIORITIES.includes(patch.priority as never)) {
    throw new ValidationError(`priority 必须是 ${TASK_PRIORITIES.join(' | ')} 之一`);
  }

  const data: Prisma.TaskUncheckedUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.assigneeId !== undefined) data.assigneeId = patch.assigneeId;

  const task = await prisma.task.update({ where: { id: taskId }, data });
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
  q?: string;
} = {}): Promise<TaskWithMeta[]> {
  const where: Prisma.TaskWhereInput = {};
  if (query.projectId) where.projectId = query.projectId;
  if (query.status) where.status = query.status;
  if (query.priority) where.priority = query.priority;

  let items = await prisma.task.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  });
  if (query.q?.trim()) {
    const q = query.q.trim();
    items = items.filter((t) =>
      matchIndex(q, buildSearchIndex(t.title, t.description ?? '')),
    );
  }
  return Promise.all(
    items.map(async (t) => ({ ...t, attachmentCount: await countAttachments('task', t.id) })),
  );
}

export async function getTask(taskId: string): Promise<Task> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError(`任务不存在: ${taskId}`);
  return task;
}

export async function deleteTask(taskId: string): Promise<void> {
  await getTask(taskId);
  await prisma.task.delete({ where: { id: taskId } });
}
