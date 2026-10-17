import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../mcp/server.js';
import { handleMcpEventMethod, MCP_EVENT_METHODS } from '../mcp/events.js';
import { loadKeyedContext, refreshKeyedContext, type McpContext } from '../mcp/context.js';
import { mcpStore } from '../mcp/context-store.js';

interface Session {
  apiKeyId: string;
  transport: StreamableHTTPServerTransport;
}

const sessions = new Map<string, Session>();

async function requestContext(request: FastifyRequest): Promise<McpContext> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new Error('缺少 Authorization: Bearer <MCP 密钥>');
  const ctx = await loadKeyedContext(header.slice(7));
  return refreshKeyedContext(ctx);
}

function replyJsonRpc(reply: { code: (status: number) => { type: (value: string) => { send: (body: unknown) => unknown } } }, id: unknown, result: unknown) {
  return reply.code(200).type('application/json').send({ jsonrpc: '2.0', id, result });
}

function isEventMethod(value: unknown): value is (typeof MCP_EVENT_METHODS)[number] {
  return typeof value === 'string' && (MCP_EVENT_METHODS as readonly string[]).includes(value);
}

export const mcpHttpRoutes: FastifyPluginAsync = async (app) => {
  app.post('/mcp', async (request, reply) => {
    let ctx: McpContext;
    try { ctx = await requestContext(request); }
    catch (error) {
      return reply.code(401).send({ error: { code: 'INVALID_API_KEY', message: error instanceof Error ? error.message : '密钥无效' } });
    }

    const body = request.body as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown } | undefined;
    if (body && isEventMethod(body.method)) {
      if (body.jsonrpc !== '2.0') {
        return reply.code(200).type('application/json').send({
          jsonrpc: '2.0',
          id: body.id ?? null,
          error: { code: -32600, message: '无效的 JSON-RPC 请求' },
        });
      }
      try {
        const result = await handleMcpEventMethod(
          body.method,
          body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params as Record<string, unknown> : {},
          ctx,
        );
        if (body.id === undefined) return reply.code(202).send();
        return replyJsonRpc(reply, body.id, result);
      } catch (error) {
        return reply.code(200).type('application/json').send({
          jsonrpc: '2.0',
          id: body.id ?? null,
          error: { code: -32602, message: error instanceof Error ? error.message : 'MCP event request failed' },
        });
      }
    }

    const sessionId = request.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
    if (existing) {
      if (existing.apiKeyId !== ctx.apiKeyId) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'MCP 会话密钥不匹配' } });
      reply.hijack();
      await mcpStore.run(ctx, () => existing.transport.handleRequest(
        request.raw as IncomingMessage,
        reply.raw as ServerResponse,
        request.body,
      ));
      return reply;
    }

    if (body?.method !== 'initialize') {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: '请先发送 MCP initialize 请求' } });
    }

    const mcpServer = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) sessions.delete(id);
      void mcpServer.close().catch((error) => {
        app.log.warn({ err: error }, '关闭 MCP HTTP server 失败');
      });
    };
    await mcpServer.connect(transport);
    reply.hijack();
    await mcpStore.run(ctx, () => transport.handleRequest(
      request.raw as IncomingMessage,
      reply.raw as ServerResponse,
      request.body,
    ));
    const id = transport.sessionId;
    if (id) sessions.set(id, { apiKeyId: ctx.apiKeyId!, transport });
    return reply;
  });

  app.get('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'];
    const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
    if (!session) return reply.code(404).send({ error: { code: 'SESSION_NOT_FOUND', message: 'MCP 会话不存在或已断开，请重新初始化' } });
    let ctx: McpContext;
    try { ctx = await requestContext(request); }
    catch (error) { return reply.code(401).send({ error: { code: 'INVALID_API_KEY', message: error instanceof Error ? error.message : '密钥无效' } }); }
    if (session.apiKeyId !== ctx.apiKeyId) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'MCP 会话密钥不匹配' } });
    reply.hijack();
    await mcpStore.run(ctx, () => session.transport.handleRequest(request.raw as IncomingMessage, reply.raw as ServerResponse));
    return reply;
  });

  app.delete('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'];
    const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
    if (!session) return reply.code(404).send({ error: { code: 'SESSION_NOT_FOUND', message: 'MCP 会话不存在或已断开' } });
    let ctx: McpContext;
    try { ctx = await requestContext(request); }
    catch (error) { return reply.code(401).send({ error: { code: 'INVALID_API_KEY', message: error instanceof Error ? error.message : '密钥无效' } }); }
    if (session.apiKeyId !== ctx.apiKeyId) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'MCP 会话密钥不匹配' } });
    await session.transport.close();
    return reply.code(204).send();
  });

  app.addHook('onClose', async () => {
    const activeSessions = [...sessions.values()];
    await Promise.all(activeSessions.map(async ({ transport }) => {
      try { await transport.close(); }
      catch (error) { app.log.warn({ err: error }, '关闭 MCP HTTP transport 失败'); }
    }));
    sessions.clear();
  });
};
