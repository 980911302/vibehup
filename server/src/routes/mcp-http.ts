import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../mcp/server.js';
import { handleMcpEventMethod, MCP_EVENT_METHODS, MCP_EVENT_PROTOCOL_VERSION } from '../mcp/events.js';
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
  app.addContentTypeParser('application/octet-stream', { parseAs: 'string' }, (_request, body, done) => done(null, body));

  async function bootstrapSession(authorization: string): Promise<Session> {
    const response = await app.inject({
      method: 'POST', url: '/mcp',
      headers: { authorization, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      payload: {
        jsonrpc: '2.0', id: 'vibehub-session-bootstrap', method: 'initialize',
        params: {
          protocolVersion: MCP_EVENT_PROTOCOL_VERSION, capabilities: {},
          clientInfo: { name: 'vibehub-authenticated-bootstrap', version: '1.0.0' },
        },
      },
    });
    const id = response.headers['mcp-session-id'];
    const session = typeof id === 'string' ? sessions.get(id) : undefined;
    if (response.statusCode !== 200 || !session) throw new Error('MCP 会话初始化失败');
    return session;
  }

  app.post('/mcp', async (request, reply) => {
    let ctx: McpContext;
    try { ctx = await requestContext(request); }
    catch (error) {
      reply.header('www-authenticate', 'Bearer resource_metadata="' + (process.env.VIBEHUB_PUBLIC_URL ?? '').replace(/\/$/, '') + '/.well-known/oauth-protected-resource/mcp"');
      return reply.code(401).send({ error: { code: 'INVALID_API_KEY', message: error instanceof Error ? error.message : '密钥无效' } });
    }

    let parsedBody = request.body;
    if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() === 'application/octet-stream') {
      if (typeof parsedBody !== 'string' || !parsedBody.trim()) return reply.code(202).send();
      try { parsedBody = JSON.parse(parsedBody); }
      catch { return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'MCP 请求必须是有效的 JSON' } }); }
      // ChatGPT may send JSON-RPC over an empty octet-stream probe or mislabeled JSON body.
      request.raw.headers['content-type'] = 'application/json';
      request.headers['content-type'] = 'application/json';
      if (!request.headers.accept?.includes('application/json') || !request.headers.accept.includes('text/event-stream')) {
        request.raw.headers.accept = 'application/json, text/event-stream';
        request.headers.accept = 'application/json, text/event-stream';
      }
    }
    const body = parsedBody as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown } | undefined;
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
    const sameKeySessions = [...sessions.values()].filter((session) => session.apiKeyId === ctx.apiKeyId);
    let existing = body?.method === 'initialize' ? undefined :
      (typeof sessionId === 'string' ? sessions.get(sessionId) : undefined) ?? sameKeySessions.at(-1);
    if (existing && existing.apiKeyId !== ctx.apiKeyId) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'MCP 会话密钥不匹配' } });
    }
    // Work background runs may omit initialize or reuse a session lost on restart.
    // Authentication above is mandatory; establish a new SDK session for this key.
    if (!existing && body?.jsonrpc === '2.0' && typeof body.method === 'string' && body.method !== 'initialize') {
      try { existing = await bootstrapSession(request.headers.authorization!); }
      catch {
        return reply.code(502).send({ error: { code: 'INTERNAL_ERROR', message: 'MCP 会话初始化失败，请重试' } });
      }
    }
    if (existing) {
      const id = existing.transport.sessionId!;
      if (sessionId !== id) {
        request.raw.headers['mcp-session-id'] = id;
        request.headers['mcp-session-id'] = id;
        const raw: string[] = [];
        for (let i = 0; i < request.raw.rawHeaders.length; i += 2) {
          if (request.raw.rawHeaders[i]!.toLowerCase() !== 'mcp-session-id') {
            raw.push(request.raw.rawHeaders[i]!, request.raw.rawHeaders[i + 1]!);
          }
        }
        request.raw.rawHeaders = [...raw, 'mcp-session-id', id];
      }
      reply.hijack();
      await mcpStore.run(ctx, () => existing.transport.handleRequest(
        request.raw as IncomingMessage,
        reply.raw as ServerResponse,
        parsedBody,
      ));
      return reply;
    }

    if (body?.method !== 'initialize') {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: '请先发送 MCP initialize 请求' } });
    }

    const mcpServer = createMcpServer();
    let transport: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      // Register the session at the SDK's initialization point. The client can
      // issue tools/list as soon as it receives the initialize response, before
      // handleRequest() has fully unwound back to this route.
      onsessioninitialized: (id) => {
        sessions.set(id, { apiKeyId: ctx.apiKeyId!, transport });
      },
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) sessions.delete(id);
      void mcpServer.close().catch((error) => {
        app.log.warn({ err: error }, '关闭 MCP HTTP server 失败');
      });
    };
    await mcpServer.connect(transport);
    transport.onerror = (error) => app.log.warn({ message: error.message }, 'MCP HTTP transport error');
    reply.hijack();
    await mcpStore.run(ctx, () => transport.handleRequest(
      request.raw as IncomingMessage,
      reply.raw as ServerResponse,
      parsedBody,
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
