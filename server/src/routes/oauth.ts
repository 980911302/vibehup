import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { parse as parseQuery } from 'node:querystring';
import { config } from '../config.js';
import { prisma } from '../core/prisma.js';
import { verifyPassword } from '../core/password.js';
import { hashToken } from '../core/tokens.js';
import { createKey, revokeKey } from '../services/api-keys.js';
import * as loginThrottle from '../services/login-throttle.js';
import { SCOPES } from '../mcp/scopes.js';
import { renderOAuthPage, type OAuthPageData } from '../core/oauth-page.js';

const DEFAULT_SCOPES = SCOPES.filter((s) => s !== 'admin');
const REQUEST_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 5 * 60_000;
const authorizationRequests = new Map<string, AuthorizationRequest>();
const authorizationCodes = new Map<string, AuthorizationCode>();

interface AuthorizationRequest {
  clientId: string; redirectUri: string; challenge: string; scope: string[];
  resource: string; state: string; expiresAt: number; clientName: string;
}
interface AuthorizationCode extends AuthorizationRequest {
  userId: string; expiresAt: number;
}

function baseUrl(): string {
  if (!config.publicUrl.startsWith('https://')) throw new Error('VIBEHUB_PUBLIC_URL 必须配置为 HTTPS 公网基址');
  return config.publicUrl;
}

function authorizationPage(reply: FastifyReply, data: OAuthPageData, status = 200) {
  return reply.code(status).header('cache-control', 'no-store')
    .header('x-frame-options', 'DENY').header('referrer-policy', 'no-referrer')
    .type('text/html; charset=utf-8').send(renderOAuthPage(data));
}

function safeRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch { return false; }
}

function parsedBody(request: { body?: unknown }): Record<string, string> {
  const body = request.body;
  if (typeof body === 'string') return parseQuery(body) as Record<string, string>;
  if (body && typeof body === 'object') return body as Record<string, string>;
  return {};
}

function prune(): void {
  const now = Date.now();
  for (const [k, v] of authorizationRequests) if (v.expiresAt < now) authorizationRequests.delete(k);
  for (const [k, v] of authorizationCodes) if (v.expiresAt < now) authorizationCodes.delete(k);
}

function oauthError(reply: { code: (n: number) => { type: (s: string) => { send: (v: unknown) => unknown } } }, status: number, error: string, description: string) {
  return reply.code(status).type('application/json').send({ error, error_description: description });
}

export const oauthRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.get('/.well-known/oauth-authorization-server', async (_request, reply) => {
    const issuer = baseUrl();
    return reply.send({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: SCOPES.filter((s) => s !== 'admin'),
    });
  });

  const protectedResourceMetadata = async (_request: unknown, reply: { send: (body: unknown) => unknown }) => reply.send({
    resource: `${baseUrl()}/mcp`,
    authorization_servers: [baseUrl()],
    scopes_supported: SCOPES.filter((s) => s !== 'admin'),
    bearer_methods_supported: ['header'],
    resource_name: 'VibeHub MCP',
  });
  // 同时提供 RFC 9728 根路径和 path-aware MCP 路径，兼容不同 OAuth discovery 客户端。
  app.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata);

  app.post('/oauth/register', async (request, reply) => {
    let body: Record<string, unknown>;
    try {
      body = typeof request.body === 'string'
        ? JSON.parse(request.body) as Record<string, unknown>
        : request.body as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body');
    }
    catch { return oauthError(reply, 400, 'invalid_client_metadata', '请求必须为 JSON'); }
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || !redirectUris.length || redirectUris.some((u) => typeof u !== 'string' || !safeRedirect(u))) {
      return oauthError(reply, 400, 'invalid_redirect_uri', 'redirect_uris 必须包含 HTTPS 或 loopback URL');
    }
    const id = randomUUID();
    await prisma.oAuthClient.create({ data: {
      id,
      clientName: typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : null,
      redirectUris: redirectUris as string[],
    } });
    return reply.code(201).send({
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      client_name: typeof body.client_name === 'string' ? body.client_name : undefined,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
  });

  app.get('/oauth/authorize', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const clientId = q.client_id ?? '';
    const redirectUri = q.redirect_uri ?? '';
    const client = await prisma.oAuthClient.findUnique({ where: { id: clientId } });
    if (!client || !client.redirectUris.includes(redirectUri) || !safeRedirect(redirectUri)) return oauthError(reply, 400, 'invalid_request', 'OAuth 客户端或回调地址无效');
    if (q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge) return oauthError(reply, 400, 'invalid_request', '必须使用 authorization_code + PKCE S256');
    const resource = `${baseUrl()}/mcp`;
    if (q.resource !== resource) return oauthError(reply, 400, 'invalid_target', 'resource 与 VibeHub MCP 地址不匹配');
    const requested = [...new Set(q.scope ? q.scope.split(/\s+/).filter(Boolean) : DEFAULT_SCOPES)];
    if (!requested.length || requested.some((s) => !SCOPES.includes(s as typeof SCOPES[number]) || s === 'admin')) return oauthError(reply, 400, 'invalid_scope', '请求的权限范围无效');
    prune();
    const nonce = randomBytes(24).toString('base64url');
    authorizationRequests.set(nonce, {
      clientId, redirectUri, challenge: q.code_challenge, scope: requested,
      resource, state: q.state ?? '', expiresAt: Date.now() + REQUEST_TTL_MS,
      clientName: client.clientName?.trim() || 'ChatGPT Work',
    });
    return authorizationPage(reply, {
      nonce, scopes: requested, clientName: client.clientName?.trim() || 'ChatGPT Work',
    });
  });

  app.post('/oauth/authorize', async (request, reply) => {
    const body = parsedBody(request);
    const pending = authorizationRequests.get(body.nonce ?? '');
    if (!pending || pending.expiresAt < Date.now()) {
      authorizationRequests.delete(body.nonce ?? '');
      return oauthError(reply, 400, 'access_denied', '授权页面已过期，请返回发起应用重新连接');
    }
    if (body.action === 'deny') {
      authorizationRequests.delete(body.nonce);
      const target = new URL(pending.redirectUri);
      target.searchParams.set('error', 'access_denied');
      target.searchParams.set('error_description', '用户取消了 VibeHub 授权');
      if (pending.state) target.searchParams.set('state', pending.state);
      return reply.redirect(target.toString());
    }
    const page = { nonce: body.nonce, scopes: pending.scope, clientName: pending.clientName, account: body.email ?? '' };
    if (body.approve !== 'on') return authorizationPage(reply, { ...page, error: '请先确认此次授权范围并勾选同意。' }, 400);
    const email = (body.email ?? '').trim().toLowerCase();
    const ip = request.ip;
    const throttle = loginThrottle.checkBlocked(email, ip);
    if (throttle.blocked) {
      reply.header('retry-after', String(Math.ceil(throttle.retryAfterMs / 1000)));
      return authorizationPage(reply, { ...page, error: '登录尝试过多，请稍后再试。' }, 429);
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(body.password ?? '', user.passwordHash)) || user.status !== 'active') {
      loginThrottle.registerFailure(email, ip);
      return authorizationPage(reply, { ...page, error: '账号或密码不正确，请检查后重试。' }, 401);
    }
    loginThrottle.clear(email, ip);
    if (user.role === 'viewer' && pending.scope.some((s) => s.endsWith(':write'))) {
      return authorizationPage(reply, { ...page, error: '当前账号为只读成员，请联系管理员调整权限，或返回应用重新申请只读授权。' }, 403);
    }
    // Recheck after password verification: one approved request can issue only one code.
    if (authorizationRequests.get(body.nonce) !== pending || pending.expiresAt < Date.now()) {
      return oauthError(reply, 400, 'access_denied', '授权请求已使用或过期，请返回应用重新连接');
    }
    authorizationRequests.delete(body.nonce);
    const code = randomBytes(32).toString('base64url');
    authorizationCodes.set(code, { ...pending, userId: user.id, expiresAt: Date.now() + CODE_TTL_MS });
    const target = new URL(pending.redirectUri);
    target.searchParams.set('code', code);
    if (pending.state) target.searchParams.set('state', pending.state);
    return reply.redirect(target.toString());
  });

  app.post('/oauth/token', async (request, reply) => {
    prune();
    const body = parsedBody(request);
    if (body.grant_type !== 'authorization_code') return oauthError(reply, 400, 'unsupported_grant_type', '仅支持 authorization_code');
    const code = body.code ?? '';
    const pending = authorizationCodes.get(code);
    authorizationCodes.delete(code);
    if (!pending || pending.expiresAt < Date.now() || pending.clientId !== body.client_id || pending.redirectUri !== body.redirect_uri || pending.resource !== body.resource) return oauthError(reply, 400, 'invalid_grant', '授权码无效、已过期或参数不匹配');
    const verifier = body.code_verifier ?? '';
    const digest = createHash('sha256').update(verifier).digest('base64url');
    const expected = Buffer.from(pending.challenge);
    const actual = Buffer.from(digest);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return oauthError(reply, 400, 'invalid_grant', 'PKCE 校验失败');
    const client = await prisma.oAuthClient.findUnique({ where: { id: pending.clientId } });
    if (!client) return oauthError(reply, 400, 'invalid_client', 'OAuth 客户端不存在');
    const created = await createKey({ name: 'ChatGPT Work', scopes: pending.scope, createdBy: pending.userId });
    return reply.send({ access_token: created.key, token_type: 'Bearer', expires_in: 90 * 24 * 60 * 60, scope: pending.scope.join(' ') });
  });

  app.post('/oauth/revoke', async (request, reply) => {
    const body = parsedBody(request);
    if (body.token) {
      const key = await prisma.apiKey.findFirst({ where: { keyHash: hashToken(body.token) } });
      if (key && !key.revokedAt) await revokeKey(key.id);
    }
    return reply.code(200).send({});
  });
};
