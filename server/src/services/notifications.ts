import type { Notification } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';

/**
 * 站内通知（R90）：交接 / 待验收 / 打回。
 * 写通知失败不能阻断主业务，createNotification 内部吞错并返回 false。
 */
export type NotificationType = 'handoff' | 'verify' | 'reopen' | 'assigned';

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  entityType?: 'bug' | 'task' | null;
  entityId?: string | null;
  projectId?: string | null;
}

export function serializeNotification(n: Notification) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    entity_type: n.entityType,
    entity_id: n.entityId,
    project_id: n.projectId,
    read_at: n.readAt?.toISOString() ?? null,
    created_at: n.createdAt.toISOString(),
  };
}

/** 写一条通知；失败隔离（通知不是主业务） */
export async function createNotification(input: NotificationInput): Promise<boolean> {
  try {
    await prisma.notification.create({
      data: {
        id: ids.attachment(),
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        projectId: input.projectId ?? null,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** 给团队里可写的人发通知（排除操作者本人）；单人团队也照常工作 */
export async function notifyWriters(
  input: Omit<NotificationInput, 'userId'> & { excludeUserId?: string | null },
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { status: 'active', role: { in: ['owner', 'admin', 'member'] } },
    select: { id: true },
  });
  await Promise.all(
    users
      .filter((u) => u.id !== input.excludeUserId)
      .map((u) => createNotification({ ...input, userId: u.id })),
  );
}

/** 给指定用户发通知；不存在/停用也静默失败（调用方已校验） */
export async function notifyUser(input: NotificationInput): Promise<void> {
  await createNotification(input);
}

export async function listNotifications(userId: string, options: { unread?: boolean; limit?: number } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const where = { userId, ...(options.unread ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items: items.map(serializeNotification), total, unread, has_more: total > items.length };
}

export async function markRead(userId: string, id: string): Promise<boolean> {
  const result = await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count > 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
