import type { FastifyPluginAsync } from 'fastify';
import { verifyAccessToken } from '../core/jwt.js';
import { UnauthorizedError } from '../core/errors.js';
import { subscribe } from '../services/sse-listener.js';

/**
 * GET /api/events —— Server-Sent Events 实时推送。
 * AI 通过 MCP 调用 update_bug_status 修复缺陷后，Web 看板无刷新归类到 Resolved（设计文档第 6 节阶段二能力）。
 *
 * 跨进程通道（卡片 29）：不订阅进程内 eventBus，改由 PG LISTEN vibehub_events 转发——
 * MCP stdio 是独立进程，其写入经 pg_notify 送达（同进程写入也走同一通道，天然去重）。
 *
 * 连接模型（卡片 F5）：LISTEN 收敛为**进程内共享单连接**（services/sse-listener），
 * 本路由只注册/退订回调，不再每请求各起一条 pg Client（原先标签页数 = PG 连接数）。
 *
 * 鉴权特殊处理：浏览器 EventSource 不支持自定义 Authorization 头，
 * 因此本路由不走全局 onRequest 守卫，改为校验 query.token（access token）；
 * 访问日志由 index.ts 的请求序列化器抹掉 `token=`（F5 第二项，避免 JWT 明文落日志）。
 */
export const eventRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/events', async (request, reply) => {
    const token = (request.query as { token?: string }).token;
    const payload = token ? verifyAccessToken(token) : null;
    if (!payload) {
      throw new UnauthorizedError();
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const unsubscribe = await subscribe((data) => {
      // 客户端已断开时写入会抛错——静默跳过，等 close 事件回收订阅
      try {
        reply.raw.write(`data: ${data}\n\n`);
      } catch {
        /* 连接已断，忽略 */
      }
    });
    reply.raw.write(': connected\n\n');

    // 心跳保活（防止代理断开空闲连接）
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch {
        /* 连接已断，忽略 */
      }
    }, 25_000);

    await new Promise<void>((resolve) => {
      request.raw.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
        resolve();
      });
    });
  });
};
