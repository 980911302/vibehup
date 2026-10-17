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
        key, // 一次性明文（之后可用 GET /:keyId/reveal 再次查看，R87）
        warning: '请立即复制到 IDE 配置；之后可在列表点「查看」再次复制（仅 owner/admin 可查看）。',
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

  // 撤销（Admin+，立即生效，行保留）
  app.post(
    '/:keyId/revoke',
    { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] },
    async (request, reply) => {
      const { keyId } = request.params as { keyId: string };
      await apiKeysService.revokeKey(keyId);
      reply.code(204);
      return null;
    },
  );

  // 查看明文（Admin+，R87：解密存储的密文；撤销后不可查看）
  app.get(
    '/:keyId/reveal',
    { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] },
    async (request, reply) => {
      const { keyId } = request.params as { keyId: string };
      const { key, name } = await apiKeysService.revealKey(keyId);
      // 明文不进访问日志：沿用统一的 ?token= 脱敏规则（字段名 key 不在日志白名单内）
      reply.header('Cache-Control', 'no-store');
      return { key, name, warning: '明文仅用于复制到 IDE 配置，请勿粘贴到公开渠道或提交进仓库。' };
    },
  );

  // 彻底删除（Admin+，R87：行从库中移除，与「撤销」区分）
  app.delete(
    '/:keyId',
    { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] },
    async (request, reply) => {
      const { keyId } = request.params as { keyId: string };
      await apiKeysService.deleteKey(keyId);
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
