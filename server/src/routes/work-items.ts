import type { FastifyPluginAsync } from 'fastify';
import { ValidationError } from '../core/errors.js';
import * as workItems from '../services/work-items.js';

export const workItemRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request) => {
    const userId = request.user?.id;
    if (!userId) throw new ValidationError('请先登录');
    const q = request.query as { project_id?: string; scope?: string };
    if (!q.project_id) throw new ValidationError('project_id 必填：队列按当前项目取数');
    return workItems.getWorkItems({
      userId,
      projectId: q.project_id,
      scope: (q.scope as workItems.WorkItemScope) || 'my',
    });
  });
};
