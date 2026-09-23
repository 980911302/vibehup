import type { FastifyPluginAsync } from 'fastify';
import { globalSearch } from '../services/search.js';

/** GET /api/search?q= —— 全局搜索（Web 端 Cmd + K 呼出，设计文档 5.1） */
export const searchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request) => {
    const { q } = request.query as { q?: string };
    return globalSearch(q ?? '');
  });
};
