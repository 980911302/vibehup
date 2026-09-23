import type { FastifyPluginAsync } from 'fastify';
import pg from 'pg';
import { NOTIFY_CHANNEL } from '../core/events.js';
import { verifyAccessToken } from '../core/jwt.js';
import { UnauthorizedError } from '../core/errors.js';
import { config } from '../config.js';

/**
 * GET /api/events —— Server-Sent Events 实时推送。
 * AI 通过 MCP 调用 update_bug_status 修复缺陷后，Web 看板无刷新归类到 Resolved（设计文档第 6 节阶段二能力）。
 *
 * 跨进程通道（卡片 29）：不再订阅进程内 eventBus，改为独立 pg Client LISTEN vibehub_events——
 * MCP stdio 是独立进程，其写入经 pg_notify 送达本连接（同进程写入也走此同一通道，天然去重）。
 *
 * 鉴权特殊处理：浏览器 EventSource 不支持自定义 Authorization 头，
 * 因此本路由不走全局 onRequest 守卫，改为校验 query.token（access token）。
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

    // LISTEN 专用连接（Prisma 池不支持 LISTEN；与业务池分离，中断不影响业务）
    const client = new pg.Client({ connectionString: config.databaseUrl });
    // pg Client 的 error 事件无监听器会抛未处理异常炸进程——必须挂（PG 重启场景）
    client.on('error', (err) => {
      request.log.warn(`SSE LISTEN 连接异常（轮询兜底中）: ${err.message}`);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
      client.on('notification', (msg) => {
        if (msg.channel === NOTIFY_CHANNEL && msg.payload) {
          reply.raw.write(`data: ${msg.payload}\n\n`);
        }
      });
      reply.raw.write(': connected\n\n');
    } catch (err) {
      // LISTEN 失败不致命：SSE 仍可用（前端 5s 轮询兜底），只丢加速
      request.log.warn(`SSE LISTEN 失败，降级轮询兜底: ${err instanceof Error ? err.message : err}`);
      reply.raw.write(': connected (listen-failed)\n\n');
    }

    // 心跳保活（防止代理断开空闲连接）
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 25_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      void client.end().catch(() => undefined);
    });

    // 保持连接挂起，不结束响应
    await new Promise<void>((resolve) => {
      request.raw.on('close', resolve);
    });
  });
};
