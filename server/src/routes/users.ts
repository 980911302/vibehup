import type { FastifyPluginAsync } from 'fastify';
import * as usersService from '../services/users.js';
import { ValidationError } from '../core/errors.js';

/**
 * 成员管理路由（步骤 02 §2.3 契约）。
 * 除列表外均需 Admin+ 权限（requireRole 在路由级声明）。
 */
export const userRoutes: FastifyPluginAsync = async (app) => {
  // 成员列表（登录即可见，配合前端成员页；role/status/q 过滤）
  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const q = request.query as Record<string, string>;
    return usersService.listUsers({ status: q.status, role: q.role, q: q.q });
  });

  // 建号（Admin+）：REGISTRATION_OPEN=false 时的主要入口
  app.post(
    '/',
    { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] },
    async (request, reply) => {
      const body = request.body as {
        email?: string;
        name?: string;
        password?: string;
        role?: string;
      };
      if (!body?.email || !body?.name) {
        throw new ValidationError('邮箱和名字为必填');
      }
      const result = await usersService.createUserByAdmin({
        email: body.email,
        name: body.name,
        password: body.password,
        role: body.role,
      });
      reply.code(201);
      return result;
    },
  );

  // 改角色/状态/名字（Admin+）
  app.patch(
    '/:userId',
    { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] },
    async (request) => {
      const { userId } = request.params as { userId: string };
      const body = request.body as { role?: string; status?: string; name?: string };
      return usersService.updateUser(request.user!.id, userId, body);
    },
  );

  // 移除成员（Admin+，不级联删业务数据）
  app.delete(
    '/:userId',
    { preHandler: [app.authenticate, app.requireRole('owner', 'admin')] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      await usersService.removeUser(request.user!.id, userId);
      reply.code(204);
      return null;
    },
  );

  // 转让 Owner（Owner only）
  app.post(
    '/transfer-ownership',
    { preHandler: [app.authenticate, app.requireRole('owner')] },
    async (request, reply) => {
      const body = request.body as { target_user_id?: string };
      if (!body?.target_user_id) {
        throw new ValidationError('target_user_id 不能为空');
      }
      await usersService.transferOwnership(request.user!.id, body.target_user_id);
      reply.code(204);
      return null;
    },
  );
};
