import type { FastifyPluginAsync } from 'fastify';
import { getStats } from '../services/stats.js';
import { getProject } from '../services/projects.js';

/**
 * GET /api/stats?project_id=<id>|all —— 统计页聚合（R85）。
 * 只读、不改任何写路径；任何登录用户可读（含 viewer）。
 */
export const statsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request) => {
    const { project_id: rawProjectId } = request.query as { project_id?: string };
    let projectId: string | null = null;
    if (rawProjectId && rawProjectId !== 'all') {
      await getProject(rawProjectId); // 未知项目在这里抛 NotFoundError → 全局错误处理器转 404
      projectId = rawProjectId;
    }
    return getStats({ projectId });
  });
};