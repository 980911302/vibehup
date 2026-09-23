import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../core/jwt.js';
import { UnauthorizedError, ForbiddenError } from '../core/errors.js';

/**
 * 鉴权装饰器（步骤 02 §2.4 契约）。
 * 由 index.ts 在根实例上 decorate（不用 encapsulate 插件，保证业务路由可见）：
 *   app.decorate('authenticate', authenticate)
 *   app.decorate('requireRole', requireRole)
 */

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; role: string; email: string };
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** 校验 Authorization: Bearer <jwt>，挂 request.user；失败 401 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError();
  }
  const payload = verifyAccessToken(header.slice(7));
  if (!payload) {
    throw new UnauthorizedError('登录态已过期，请重新登录', 'INVALID_TOKEN');
  }
  request.user = { id: payload.sub, role: payload.role, email: payload.email };
}

/** 角色守卫：403 FORBIDDEN */
export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw new UnauthorizedError();
    }
    if (!roles.includes(request.user.role as Role)) {
      throw new ForbiddenError('该操作需要更高的角色权限');
    }
  };
}
