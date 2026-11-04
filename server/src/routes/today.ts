import type { FastifyPluginAsync } from 'fastify';
import { getToday } from '../services/today.js';

/**
 * GET /api/today —— 今日工作台聚合（R89）。只读，任何登录角色可读。
 * 跨项目：待我处理 / 待验收 / AI 进行中 / 正在干 + 今日统计。
 */
export const todayRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request) => {
    return getToday(request.user!.id);
  });
};
