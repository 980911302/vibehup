import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import * as authService from '../services/auth.js';
import { serializeUser } from '../core/serialize-user.js';
import { ValidationError, RateLimitedError } from '../core/errors.js';
import { isRegistrationOpen } from '../services/system.js';
import * as loginThrottle from '../services/login-throttle.js';

/** 客户端 IP：X-Forwarded-For 首个地址优先（容器/反向代理），否则取直连地址 */
function clientIp(request: FastifyRequest): string {
  const fwd = request.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const first = raw?.split(',')[0]?.trim();
  return first || request.ip || 'unknown';
}

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

  // 登录（防暴力：按邮箱+客户端 IP 滑动窗口限流，见 F4）
  app.post('/login', async (request) => {
    const body = request.body as { email?: string; password?: string };
    if (!body?.email || !body?.password) {
      throw new ValidationError('邮箱和密码为必填');
    }
    const email = body.email.trim().toLowerCase();
    const ip = clientIp(request);

    const state = loginThrottle.checkBlocked(email, ip);
    if (state.blocked) {
      const minutes = Math.max(1, Math.ceil(state.retryAfterMs / 60000));
      throw new RateLimitedError(`登录尝试次数过多，请 ${minutes} 分钟后再试`, Math.ceil(state.retryAfterMs / 1000));
    }

    try {
      const result = await authService.login({ email, password: body.password });
      loginThrottle.clear(email, ip);
      return result;
    } catch (err) {
      // 仅失败计入（用户不存在/密码错/被禁用）；成功路径已 clear
      loginThrottle.registerFailure(email, ip);
      throw err;
    }
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
