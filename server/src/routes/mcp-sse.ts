import type { FastifyPluginAsync } from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from '../mcp/server.js';
import { loadKeyedContext, McpContextError, type McpContext } from '../mcp/context.js';
import { mcpStore } from '../mcp/context-store.js';

/**
 * MCP SSE 传输（步骤 03 §3.6 / 《容器化部署规范》§7）。
 * 容器部署时 IDE 直连本端点；stdio 无法跨越容器边界。
 *
 *   GET  /mcp/sse       Bearer <vhk_> 握手 → 建立 SSE 流（endpoint 事件回带 sessionId）
 *   POST /mcp/messages?sessionId=xxx    JSON-RPC 消息（session 即凭据）
 *
 * 与 stdio 共用 createMcpServer() 工厂与 guard/打点逻辑。
 */

interface Session {
  transport: SSEServerTransport;
  ctx: McpContext;
}

/** sessionId → transport（进程内；单机单容器无需外部存储） */
const sessions = new Map<string, Session>();

export const mcpSseRoutes: FastifyPluginAsync = async (app) => {
  // 握手：校验 Bearer 密钥并建立 SSE 流
  app.get('/sse', async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: '缺少 Authorization: Bearer <MCP 密钥>，请在 Web 端「密钥」页创建' },
      });
    }
    let ctx: McpContext;
    try {
      ctx = await loadKeyedContext(header.slice(7));
    } catch (err) {
      const message = err instanceof McpContextError ? err.message : '密钥无效';
      return reply.code(401).send({ error: { code: 'INVALID_API_KEY', message } });
    }

    const res = reply.raw as ServerResponse;
    // 反向代理（nginx 等）默认缓冲响应：tools/list 这类大消息会被扣住，IDE 侧表现为
    // 「tools fetch failed: Request timed out」。transport 的 writeHead 会合并这里预置的头
    res.setHeader('X-Accel-Buffering', 'no');
    // endpoint 事件会由 transport 自动追加 ?sessionId=xxx
    const transport = new SSEServerTransport('/mcp/messages', res);
    sessions.set(transport.sessionId, { transport, ctx });

    const server = createMcpServer();
    await server.connect(transport);

    request.raw.on('close', () => {
      sessions.delete(transport.sessionId);
      void server.close();
    });

    // 连接挂起：transport 已接管 response 写入
    await new Promise<void>((resolve) => {
      request.raw.on('close', resolve);
    });
  });

    // 消息转发：按 sessionId 找到 transport，在握手时的 keyed 上下文内处理
    // （mcpStore 包裹：scope 校验与打点归属都走该连接密钥——R69 安全修复）
    app.post('/messages', async (request, reply) => {
      const { sessionId } = request.query as { sessionId?: string };
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) {
        return reply.code(404).send({
          error: { code: 'SESSION_NOT_FOUND', message: '会话不存在或已断开，请重新建立 SSE 连接' },
        });
      }
      await mcpStore.run(session.ctx, () =>
        session.transport.handlePostMessage(
          request.raw as IncomingMessage & { body?: unknown },
          reply.raw as ServerResponse & { writeHead: unknown },
          request.body as unknown,
        ),
      );
    });
};
