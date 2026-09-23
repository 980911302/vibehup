import type { FastifyPluginAsync } from 'fastify';
import * as authService from '../services/auth.js';
import { serializeUser } from '../core/serialize-user.js';
import { ValidationError } from '../core/errors.js';
import { isRegistrationOpen } from '../services/system.js';

/**
 * 认证路由（步骤 02 §2.3 契约）。
 * /api/auth/* 为白名单：不挂登录守卫。
 */
export const authRoutes: FastifyPluginAsync = async (app) => {
  // 注册（首位用户自动成为 Owner；REGISTRATION_OPEN=false 时关闭，检查在 service 内）
  app.post('/register', async (request, reply) => {
    const body = request.body as { email?: string; password?: string; name?: string };
    if (!body?.email || !body?.password || !body?.name) {
      throw new ValidationError('邮箱、密码、名字均为必填');
    }
    const result = await authService.register({
      email: body.email,
      password: body.password,
      name: body.name,
    });
    reply.code(201);
    return result;
  });

  // 登录
  app.post('/login', async (request) => {
    const body = request.body as { email?: string; password?: string };
    if (!body?.email || !body?.password) {
      throw new ValidationError('邮箱和密码为必填');
    }
    return authService.login({ email: body.email, password: body.password });
  });

  // 刷新（一次性轮换 + 重放检测）
  app.post('/refresh', async (request) => {
    const body = request.body as { refresh_token?: string };
    if (!body?.refresh_token) {
      throw new ValidationError('refresh_token 不能为空');
    }
    return authService.refresh(body.refresh_token);
  });

  // 登出（撤销该刷新令牌）
  app.post('/logout', async (request, reply) => {
    const body = request.body as { refresh_token?: string };
    if (body?.refresh_token) {
      await authService.logout(body.refresh_token);
    }
    reply.code(204);
    return null;
  });

  // 登录页公共配置：是否开放自助注册（无需登录）
  app.get('/config', async () => {
    return { registration_open: await isRegistrationOpen() };
  });

  // 当前用户信息 + 统计（响应结构 { user, stats }，与前端 api.ts 的 MeResult 对齐。
  // authService.me 返回的已是序列化后的扁平对象，此处仅拆分为 user/stats 两层）
  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    const result = await authService.me(request.user!.id);
    const { stats, ...user } = result;
    return { user, stats };
  });

  // 更新个人资料
  app.patch('/me', { preHandler: [app.authenticate] }, async (request) => {
    const body = request.body as { name?: string };
    return authService.updateProfile(request.user!.id, { name: body?.name });
  });

  // 修改密码（吊销全部会话）
  app.post('/me/password', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as { old_password?: string; new_password?: string };
    if (!body?.old_password || !body?.new_password) {
      throw new ValidationError('旧密码和新密码均为必填');
    }
    await authService.changePassword(request.user!.id, body.old_password, body.new_password);
    reply.code(204);
    return null;
  });
};

export { serializeUser };
