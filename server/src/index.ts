import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from './config.js';
import { isAppError, RateLimitedError } from './core/errors.js';
import { prisma } from './core/prisma.js';
import { projectRoutes } from './routes/projects.js';
import { bugRoutes } from './routes/bugs.js';
import { taskRoutes } from './routes/tasks.js';
import { noteRoutes } from './routes/notes.js';
import { attachmentRoutes, attachmentRawRoutes, uploadRoutes } from './routes/attachments.js';
import { eventRoutes } from './routes/events.js';
import { activityRoutes } from './routes/activity.js';
import { searchRoutes } from './routes/search.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { mcpSseRoutes } from './routes/mcp-sse.js';
import { bugExtrasRoutes } from './routes/bug-extras.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { systemRoutes } from './routes/system.js';
import { authenticate, requireRole } from './plugins/authenticate.js';

async function ensureDirs(): Promise<void> {
  fs.mkdirSync(paths.uploads, { recursive: true });
  fs.mkdirSync(paths.derived, { recursive: true });
  fs.mkdirSync(paths.trash, { recursive: true });
}

export async function buildServer(opts: { loggerStream?: NodeJS.WritableStream } = {}) {
  await ensureDirs();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      ...(opts.loggerStream ? { stream: opts.loggerStream } : {}),
      // F5：请求日志脱敏——/api/events?token=<JWT> 是唯一把 access token 放进 URL 的入口
      // （EventSource 带不了 Authorization 头），原样打日志等于把可用令牌写进日志文件。
      serializers: {
        req: (req) => ({
          method: req.method,
          url: typeof req.url === 'string' ? req.url.replace(/([?&]token=)[^&#\s]*/gi, '$1[已脱敏]') : req.url,
          host: req.headers?.host,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort,
        }),
      },
    },
    bodyLimit: 20 * 1024 * 1024, // 20MB JSON body（base64 上传走单独路由）
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: config.maxUploadFiles,
      fields: 20,
    },
  });

  // 统一错误处理
  app.setErrorHandler((err, _req, reply) => {
    if (isAppError(err)) {
      // 429 附带 Retry-After（秒），客户端可据此提示「请 X 分钟后再试」（卡片 F4）
      if (err instanceof RateLimitedError) reply.header('retry-after', String(err.retryAfterSec));
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message },
      });
    }
    // multipart 等 fastify 内置错误
    const anyErr = err as { statusCode?: number; code?: string; message: string };
    if (anyErr.statusCode && anyErr.statusCode < 500) {
      return reply.code(anyErr.statusCode).send({
        error: { code: anyErr.code ?? 'HTTP_ERROR', message: anyErr.message },
      });
    }
    app.log.error(err);
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: '内部服务器错误' },
    });
  });

  // 鉴权装饰器（挂在根实例，业务路由插件均可见）
  app.decorate('authenticate', authenticate);
  app.decorate('requireRole', requireRole);

  // RESTful API
  // /api/auth 为白名单（登录注册不该有守卫）
  await app.register(authRoutes, { prefix: '/api/auth' });
  // /api/users 挂在守卫内，角色控制在各路由 preHandler 声明
  await app.register(async (scope) => {
    scope.addHook('onRequest', app.authenticate);
    await scope.register(userRoutes, { prefix: '/api/users' });
  });
  // 业务路由统一挂登录守卫（MCP 不经 HTTP，不受影响）
  const guarded = [
    [projectRoutes, '/api/projects'],
    [bugRoutes, '/api/bugs'],
    [bugExtrasRoutes, '/api/bugs'],
    [taskRoutes, '/api/tasks'],
    [noteRoutes, '/api/notes'],
    [attachmentRoutes, '/api/attachments'],
    [uploadRoutes, '/api/upload'],
    [searchRoutes, '/api/search'],
    [apiKeyRoutes, '/api/api-keys'],
    [systemRoutes, '/api/system'],
  ] as const;
  for (const [routes, prefix] of guarded) {
    await app.register(async (scope) => {
      scope.addHook('onRequest', app.authenticate);
      await scope.register(routes, { prefix });
    });
  }
  // SSE：EventSource 不能带 Authorization 头，路由内自行校验 query.token（见 routes/events.ts）
  await app.register(eventRoutes, { prefix: '/api' });
  // 附件原文件：<img> 同样带不了 Authorization 头，路由内「签名链接或 Bearer」二选一（R76）
  await app.register(attachmentRawRoutes, { prefix: '/api/attachments' });
  await app.register(activityRoutes, { prefix: '/api/activity' });
  // MCP SSE 传输：API Key（Bearer）鉴权，不经 HTTP 用户守卫（容器化部署形态）
  await app.register(mcpSseRoutes, { prefix: '/mcp' });

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'vibehub',
    time: new Date().toISOString(),
  }));

  // 托管前端静态导出产物（单容器部署：Fastify 同时提供 API 与页面）
  // 三候选：monorepo 布局（server/ 上级）/ 容器布局（cwd=/app 的 web/out）/ web-dist 兜底
  const webOut = path.resolve(process.cwd(), '../web/out');
  const webOutApp = path.resolve(process.cwd(), 'web/out');
  const webDist = path.resolve(process.cwd(), 'web-dist');
  const staticRoot = fs.existsSync(path.join(webOut, 'index.html'))
    ? webOut
    : fs.existsSync(path.join(webOutApp, 'index.html'))
      ? webOutApp
      : fs.existsSync(path.join(webDist, 'index.html'))
        ? webDist
        : null;

  if (staticRoot) {
    // extensions: html —— 让 /login、/board 这类干净 URL 映射到 login.html、board.html
    await app.register(fastifyStatic, { root: staticRoot, prefix: '/', extensions: ['html'] });
    // SPA 回退：未知路径返回 index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
      }
      return reply.sendFile('index.html');
    });
    app.log.info(`前端静态资源托管自: ${staticRoot}`);
  } else {
    app.log.warn('未找到前端构建产物（web/out），仅提供 API 服务');
  }

  return app;
}

/** 直接运行启动（`node dist/index.js`）；容器内由 bootstrap.ts 导入调用 */
export async function main(): Promise<void> {
  const app = await buildServer();
  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`VibeHub HTTP 服务已启动: http://${config.host}:${config.port}`);
    app.log.info(`MCP Server 启动命令: npm run start:mcp -w server`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// 直接运行时启动（测试通过 buildServer 注入）
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
