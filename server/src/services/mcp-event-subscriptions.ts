import { createHash } from 'node:crypto';
import { prisma } from '../core/prisma.js';
import { decryptSecret, encryptSecret } from '../core/key-cipher.js';
import type { McpContext } from '../mcp/context.js';
import { verifyWebhookCallback, type WebhookSubscription } from './mcp-event-webhook.js';

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const SHARED_PAYLOAD_SCHEMA = {
  type: 'object',
  properties: {
    project_id: { type: ['string', 'null'] },
    entity_id: { type: 'string' },
    status: { type: 'string' },
  },
  required: ['project_id', 'entity_id'],
  additionalProperties: false,
};

export const MCP_EVENT_NAMES = [
  'bug.created', 'bug.updated', 'task.created', 'task.updated', 'task.deleted',
  'note.created', 'note.updated', 'note.deleted', 'attachment.created',
  'attachment.deleted', 'skill.changed',
] as const;

export function listMcpEventDefinitions() {
  return MCP_EVENT_NAMES.map((name) => ({
    name,
    description: `VibeHub 中发生了 ${name} 事件。事件仅包含实体 ID 与项目 ID；需要详情时用对应 MCP 工具读取。`,
    delivery: ['webhook'],
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string', description: '仅接收指定项目的事件' } },
      additionalProperties: false,
    },
    payloadSchema: SHARED_PAYLOAD_SCHEMA,
  }));
}

function requireSubscribableKey(ctx: McpContext): string {
  if (ctx.mode !== 'keyed' || !ctx.apiKeyId) throw new Error('事件订阅需要使用已认证的 VibeHub API 密钥');
  if (!ctx.scopes.has('context:read') && !ctx.scopes.has('admin')) {
    throw new Error('事件订阅需要 context:read 权限');
  }
  return ctx.apiKeyId;
}

function canonicalJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
}

function subscriptionId(apiKeyId: string, eventName: string, args: Record<string, unknown>, callbackUrl: string): string {
  const digest = createHash('sha256')
    .update([apiKeyId, eventName, canonicalJson(args), callbackUrl].join('\u0000'))
    .digest('hex');
  return `mces_${digest.slice(0, 40)}`;
}

function validateEventArguments(eventName: string, value: unknown): Record<string, unknown> {
  if (!MCP_EVENT_NAMES.includes(eventName as (typeof MCP_EVENT_NAMES)[number])) throw new Error('不支持的事件名称');
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('事件筛选参数必须是对象');
  const args = value as Record<string, unknown>;
  if (Object.keys(args).some((key) => key !== 'project_id')) throw new Error('事件仅支持 project_id 筛选');
  if (args.project_id !== undefined && (typeof args.project_id !== 'string' || args.project_id.length > 128)) {
    throw new Error('project_id 必须是 128 字符以内的字符串');
  }
  return args;
}

function parseDelivery(value: unknown): WebhookSubscription {
  if (!value || typeof value !== 'object') throw new Error('缺少 webhook delivery 配置');
  const delivery = value as Record<string, unknown>;
  if (delivery.mode !== 'webhook' || typeof delivery.url !== 'string' || typeof delivery.secret !== 'string') {
    throw new Error('事件仅支持包含 url 和 secret 的 webhook delivery');
  }
  return { id: '', callbackUrl: delivery.url, secret: delivery.secret };
}

export async function createOrRefreshMcpEventSubscription(
  ctx: McpContext,
  params: Record<string, unknown>,
): Promise<{ id: string; refreshBefore: string | null; cursor: null; truncated: false }> {
  const apiKeyId = requireSubscribableKey(ctx);
  if (typeof params.name !== 'string') throw new Error('缺少事件名称');
  const eventName = params.name;
  const args = validateEventArguments(eventName, params.arguments);
  const delivery = parseDelivery(params.delivery);
  const id = subscriptionId(apiKeyId, eventName, args, delivery.callbackUrl);
  delivery.id = id;
  const secretCipher = encryptSecret(delivery.secret);
  if (!secretCipher) throw new Error('服务未配置 JWT_SECRET，无法安全保存 webhook 签名密钥');

  const requestedTtl = params.ttlMs;
  const ttlMs = requestedTtl === null ? null : typeof requestedTtl === 'number' && Number.isFinite(requestedTtl)
    ? Math.min(MAX_TTL_MS, Math.max(60_000, requestedTtl))
    : DEFAULT_TTL_MS;
  const expiresAt = ttlMs === null ? null : new Date(Date.now() + ttlMs);

  await verifyWebhookCallback(delivery);
  await prisma.mcpEventSubscription.upsert({
    where: { id },
    create: {
      id,
      apiKeyId,
      eventName,
      arguments: canonicalJson(args),
      callbackUrl: delivery.callbackUrl,
      secretCipher,
      expiresAt,
    },
    update: { secretCipher, expiresAt, callbackUrl: delivery.callbackUrl },
  });
  return { id, refreshBefore: expiresAt?.toISOString() ?? null, cursor: null, truncated: false };
}

export async function removeMcpEventSubscription(ctx: McpContext, params: Record<string, unknown>): Promise<Record<string, never>> {
  const apiKeyId = requireSubscribableKey(ctx);
  if (typeof params.name !== 'string' || typeof params.delivery !== 'object' || !params.delivery) {
    throw new Error('取消订阅需要原事件名称、筛选参数与 callback URL');
  }
  const delivery = params.delivery as Record<string, unknown>;
  if (typeof delivery.url !== 'string') throw new Error('缺少 callback URL');
  const args = validateEventArguments(params.name, params.arguments);
  const id = subscriptionId(apiKeyId, params.name, args, delivery.url);
  await prisma.mcpEventSubscription.deleteMany({ where: { id, apiKeyId } });
  return {};
}

export async function getActiveMcpEventSubscriptions(eventName: string) {
  const records = await prisma.mcpEventSubscription.findMany({
    where: { eventName, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { apiKey: { include: { creator: { select: { status: true } } } } },
  });
  return records.flatMap((record) => {
    const key = record.apiKey;
    if (key.revokedAt || (key.expiresAt && key.expiresAt.getTime() < Date.now()) || key.creator?.status === 'disabled') return [];
    if (!key.scopes.includes('context:read') && !key.scopes.includes('admin')) return [];
    const secret = decryptSecret(record.secretCipher);
    if (!secret) return [];
    let args: Record<string, unknown>;
    try { args = JSON.parse(record.arguments) as Record<string, unknown>; } catch { return []; }
    return [{ id: record.id, callbackUrl: record.callbackUrl, secret, args }];
  });
}
