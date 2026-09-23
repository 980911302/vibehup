import type { FastifyPluginAsync } from 'fastify';
import * as apiKeysService from '../services/api-keys.js';
import { ValidationError } from '../core/errors.js';

/**
 * MCP 密钥管理路由（商业产品计划 §4）。
 * 创建/轮换仅 Admin+；查看列表需登录。
 */
export const apiKeyRoutes: FastifyPluginAsync = async (app) => {
  // 列表（登录即可——成员需要知道有哪些密钥可用；敏感字段已掩码）
  app.get('/', { preHandler: [app.authenticate] }, async () => {
    return apiKeysService.listKeys();
  });

  // 创建（Admin+，返回一次性明文）
  app.post(
    '/',
    { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] },
    async (request, reply) => {
      const body = request.body as {
        name?: string;
        scopes?: string[];
        rate_limit?: number;
        expires_in_days?: number | null;
      };
      if (!body?.name) throw new ValidationError('密钥名称不能为空');
      const { key, view } = await apiKeysService.createKey({
        name: body.name,
        scopes: body.scopes,
        rateLimit: body.rate_limit,
        expiresInDays: body.expires_in_days,
        createdBy: request.user!.id,
      });
      reply.code(201);
      return {
        key, // 一次性明文，仅此次返回
        warning: '请立即复制保存；关闭后不可再查看，遗失只能轮换。',
        api_key: view,
      };
    },
  );

  // 轮换（Admin+，旧密钥 24h 宽限）
  app.post(
    '/:keyId/rotate',
    { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] },
    async (request) => {
      const { keyId } = request.params as { keyId: string };
      return apiKeysService.rotateKey(keyId, request.user!.id);
    },
  );

  // 撤销（Admin+，立即生效）
  app.delete(
    '/:keyId',
    { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] },
    async (request, reply) => {
      const { keyId } = request.params as { keyId: string };
      await apiKeysService.revokeKey(keyId);
      reply.code(204);
      return null;
    },
  );

  // 用量分析（Admin+）
  app.get(
    '/:keyId/usage',
    { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] },
    async (request) => {
      const { keyId } = request.params as { keyId: string };
      const { days } = request.query as { days?: string };
      return apiKeysService.keyUsage(keyId, days ? Number(days) : 30);
    },
  );
};
