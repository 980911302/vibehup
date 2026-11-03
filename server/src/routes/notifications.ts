import type { FastifyPluginAsync } from 'fastify';
import { ValidationError } from '../core/errors.js';
import * as notifications from '../services/notifications.js';

export const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request) => {
    const userId = request.user?.id;
    if (!userId) throw new ValidationError('请先登录');
    const q = request.query as { unread?: string; limit?: string };
    return notifications.listNotifications(userId, {
      unread: q.unread === '1' || q.unread === 'true',
      limit: q.limit ? Number(q.limit) : undefined,
    });
  });

  fastify.patch('/read-all', async (request) => {
    const userId = request.user?.id;
    if (!userId) throw new ValidationError('请先登录');
    return { updated: await notifications.markAllRead(userId) };
  });

  fastify.patch('/:id/read', async (request) => {
    const userId = request.user?.id;
    if (!userId) throw new ValidationError('请先登录');
    const { id } = request.params as { id: string };
    return { ok: await notifications.markRead(userId, id) };
  });
};
