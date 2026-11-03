import type { FastifyPluginAsync } from 'fastify';
import * as apiKeysService from '../services/api-keys.js';
import { ValidationError } from '../core/errors.js';

/**
 * MCP 密钥管理路由（R89：每个成员都能为自己创建，密钥即个人 AI 身份）。
 * 普通成员只能看/管自己的密钥；管理员可带 all=1 看团队全部并审计。
 */
export const apiKeyRoutes: FastifyPluginAsync = async (app) => {
  const actorOf = (request: { user?: { id: string; role: string } }): apiKeysService.KeyActor => ({
    id: request.user!.id,
    role: request.user!.role,
  });

  // 列表：默认只有自己的密钥；Admin+ 传 all=1 可看团队全部
  app.get('/', async (request) => {
    const { all } = request.query as { all?: string };
    const role = request.user!.role;
    const isAdmin = role === 'owner' || role === 'admin';
    const scopeAll = all === '1' && isAdmin;
    return apiKeysService.listKeys(scopeAll ? undefined : request.user!.id);
  });

  // 创建：登录即可；能建哪些 scope 由本人角色决定（服务端校验，不信任前端）
  app.post('/', async (request, reply) => {
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
      warning: '请立即复制到 IDE 配置；之后可在列表点「查看」再次复制（本人或管理员可查看）。',
      api_key: view,
    };
  });

  // 轮换（本人或 Admin+，旧密钥 24h 宽限）
  app.post('/:keyId/rotate', async (request) => {
    const { keyId } = request.params as { keyId: string };
    return apiKeysService.rotateKey(keyId, actorOf(request));
  });

  // 撤销（本人或 Admin+，立即生效，行保留）
  app.post('/:keyId/revoke', async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    await apiKeysService.revokeKey(keyId, actorOf(request));
    reply.code(204);
    return null;
  });

  // 查看明文（本人或 Admin+；撤销后不可查看）
  app.get('/:keyId/reveal', async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    const { key, name } = await apiKeysService.revealKey(keyId, actorOf(request));
    // 明文不进访问日志：沿用统一的 ?token= 脱敏规则（字段名 key 不在日志白名单内）
    reply.header('Cache-Control', 'no-store');
    return { key, name, warning: '明文仅用于复制到 IDE 配置，请勿粘贴到公开渠道或提交进仓库。' };
  });

  // 彻底删除（本人或 Admin+；行从库中移除，与「撤销」区分）
  app.delete('/:keyId', async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    await apiKeysService.deleteKey(keyId, actorOf(request));
    reply.code(204);
    return null;
  });

  // 用量分析（本人或 Admin+）
  app.get('/:keyId/usage', async (request) => {
    const { keyId } = request.params as { keyId: string };
    const { days } = request.query as { days?: string };
    return apiKeysService.keyUsage(keyId, days ? Number(days) : 30, actorOf(request));
  });
};
