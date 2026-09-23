import type { FastifyPluginAsync } from 'fastify';
import * as systemService from '../services/system.js';
import { ValidationError } from '../core/errors.js';

/** 系统设置路由：GET 需登录；PATCH 仅 Owner */
export const systemRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: [app.authenticate] }, async () => {
    return systemService.getAllSettings();
  });

  app.patch(
    '/',
    { preHandler: [app.authenticate, app.requireRole('owner')] },
    async (request) => {
      const body = request.body as Record<string, string>;
      if (!body || Object.keys(body).length === 0) {
        throw new ValidationError('设置项不能为空');
      }
      for (const [key, value] of Object.entries(body)) {
        if (!/^[a-z_]{1,64}$/.test(key)) {
          throw new ValidationError(`非法设置项: ${key}`);
        }
        await systemService.setSetting(key, String(value));
      }
      return systemService.getAllSettings();
    },
  );
};
