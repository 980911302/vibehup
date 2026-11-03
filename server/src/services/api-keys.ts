import type { ApiKey, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { hashToken } from '../core/tokens.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../core/errors.js';
import { decryptSecret, encryptSecret } from '../core/key-cipher.js';
import { disallowedScopes, isKnownScope, SCOPES } from '../mcp/scopes.js';

/**
 * MCP 密钥管理（R89：密钥即个人 AI 身份）。
 * 每个成员都能为自己创建密钥，权限上限跟随本人角色；管理员可审计/管理全部密钥。
 * 库中存 SHA-256 哈希（鉴权用）+ AES-256-GCM 密文（R87：本人可随时查看/复制）。
 */

/** 默认有效期 90 天；轮换宽限期 24h */
const DEFAULT_TTL_DAYS = 90;
export const ROTATION_GRACE_HOURS = 24;

export interface KeyActor {
  id: string;
  role: string;
}

export interface ApiKeyView {
  id: string;
  name: string;
  /** 掩码：vhk_live_7Kd9•••••••• */
  masked: string;
  scopes: string[];
  rate_limit: number;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  status: 'active' | 'expired' | 'revoked';
  /** 明文是否可恢复（R87：false 表示该密钥建于加密存储之前或签名密钥已更换） */
  can_reveal: boolean;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

type KeyWithCreator = ApiKey & { creator?: { name: string } | null };

function maskOf(prefix: string): string {
  return `${prefix}${'•'.repeat(8)}`;
}

function statusOf(key: { revokedAt: Date | null; expiresAt: Date | null }): ApiKeyView['status'] {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return 'expired';
  return 'active';
}

function toView(key: KeyWithCreator): ApiKeyView {
  return {
    id: key.id,
    name: key.name,
    masked: maskOf(key.keyPrefix),
    scopes: key.scopes,
    rate_limit: key.rateLimit,
    last_used_at: key.lastUsedAt?.toISOString() ?? null,
    expires_at: key.expiresAt?.toISOString() ?? null,
    revoked_at: key.revokedAt?.toISOString() ?? null,
    status: statusOf(key),
    can_reveal: Boolean(key.keyCipher),
    created_by: key.createdBy,
    created_by_name: key.creator?.name ?? null,
    created_at: key.createdAt.toISOString(),
  };
}

export interface CreateKeyInput {
  name: string;
  scopes?: string[];
  rateLimit?: number;
  expiresInDays?: number | null;
  createdBy: string;
}

/** 创建密钥：返回一次性明文；scope 上限由创建人的真实角色决定 */
export async function createKey(input: CreateKeyInput): Promise<{ key: string; view: ApiKeyView }> {
  if (!input.name?.trim()) throw new ValidationError('密钥名称不能为空');
  const scopes = input.scopes ?? ['context:read'];
  for (const s of scopes) {
    if (!isKnownScope(s)) throw new ValidationError(`未知 scope: ${s}。可用: ${SCOPES.join(' / ')}`);
  }
  if (input.rateLimit !== undefined && (input.rateLimit < 1 || input.rateLimit > 10_000)) {
    throw new ValidationError('rate_limit 需在 1-10000 之间');
  }

  const creator = await prisma.user.findUnique({
    where: { id: input.createdBy },
    select: { role: true, status: true },
  });
  if (!creator) throw new ValidationError('密钥所属用户不存在，请重新登录后重试');
  if (creator.status !== 'active') {
    throw new ForbiddenError('该账号已被禁用，不能创建或轮换密钥；请联系管理员恢复账号');
  }
  const denied = disallowedScopes(creator.role, scopes);
  if (denied.length > 0) {
    const message =
      creator.role === 'viewer'
        ? `只读成员只能创建读取类密钥，以下权限超出角色：${denied.join(' / ')}。需要写入请联系管理员调整角色`
        : `以下 scope 超出当前角色（${creator.role}）：${denied.join(' / ')}`;
    throw new ForbiddenError(message);
  }

  const plaintext = `vhk_live_${randomBytes(24).toString('base64url')}`;
  const salt = randomBytes(16).toString('base64'); // schema 要求；实际校验用 hashToken
  const ttlDays = input.expiresInDays === undefined ? DEFAULT_TTL_DAYS : input.expiresInDays;

  const row = await prisma.apiKey.create({
    data: {
      id: ids.attachment(),
      name: input.name.trim(),
      keyPrefix: plaintext.slice(0, 13),
      keyHash: hashToken(plaintext),
      salt,
      keyCipher: encryptSecret(plaintext),
      scopes,
      rateLimit: input.rateLimit ?? 300,
      expiresAt: ttlDays === null ? null : new Date(Date.now() + ttlDays * 86_400_000),
      createdBy: input.createdBy,
    },
    include: { creator: { select: { name: true } } },
  });
  return { key: plaintext, view: toView(row) };
}

/** 密钥创建人（MCP 建单时记为缺陷提出人）；密钥不存在或创建人已移除返回 null */
export async function getKeyCreatorId(keyId: string): Promise<string | null> {
  const key = await prisma.apiKey.findUnique({ where: { id: keyId }, select: { createdBy: true } });
  return key?.createdBy ?? null;
}

/**
 * 密钥列表（掩码；不含明文与哈希）。
 * ownerId 为空 = 团队全部（仅管理员路由这样调用）；普通成员只拿到自己的密钥。
 */
export async function listKeys(ownerId?: string): Promise<ApiKeyView[]> {
  const keys = await prisma.apiKey.findMany({
    where: ownerId ? { createdBy: ownerId } : undefined,
    orderBy: { createdAt: 'desc' },
    include: { creator: { select: { name: true } } },
  });
  return keys.map(toView);
}

function isAdmin(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

/** 本人或管理员才可管理该密钥；普通成员拿别人的 id 直接 403（不泄露是否存在） */
async function loadManageable(keyId: string, actor: KeyActor): Promise<ApiKey> {
  const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!key) throw new NotFoundError(`密钥不存在: ${keyId}`);
  if (!isAdmin(actor.role) && key.createdBy !== actor.id) {
    throw new ForbiddenError('只能管理自己的密钥；团队密钥由管理员处理');
  }
  return key;
}

/**
 * 轮换：签发新密钥（同名/同 scope/同限速），旧密钥进入 24h 宽限期。
 * 管理员替别人轮换时，新密钥仍归原主人，避免「一换就变成管理员的钥匙」。
 */
export async function rotateKey(
  keyId: string,
  actor: KeyActor,
): Promise<{ key: string; view: ApiKeyView; previous_grace_until: string }> {
  const old = await loadManageable(keyId, actor);
  if (old.revokedAt) throw new ValidationError('已撤销的密钥不能轮换，请创建新密钥');

  const graceUntil = new Date(Date.now() + ROTATION_GRACE_HOURS * 3_600_000);
  const created = await createKey({
    name: old.name,
    scopes: old.scopes,
    rateLimit: old.rateLimit,
    createdBy: old.createdBy ?? actor.id,
  });

  // 旧密钥有效期压缩到宽限期结束（不晚于原有效期）
  const newExpiry = old.expiresAt && old.expiresAt < graceUntil ? old.expiresAt : graceUntil;
  await prisma.apiKey.update({ where: { id: keyId }, data: { expiresAt: newExpiry } });

  return { ...created, previous_grace_until: newExpiry.toISOString() };
}

/** 内部撤销（OAuth token revocation 等协议路径）：凭令牌本身授权，不再校验用户归属 */
export async function revokeKeyById(keyId: string): Promise<void> {
  const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!key) throw new NotFoundError(`密钥不存在: ${keyId}`);
  await prisma.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
}

/** 撤销：立即失效（行保留，列表显示「已撤销」）；本人或管理员可操作 */
export async function revokeKey(keyId: string, actor: KeyActor): Promise<void> {
  await loadManageable(keyId, actor);
  await revokeKeyById(keyId);
}

/**
 * 查看明文（R87）：本人或管理员显式调用，解密 AES-256-GCM 密文。
 * 撤销后不再返回——撤销即凭据作废，避免「撤销了还能看到明文」的错觉。
 */
export async function revealKey(keyId: string, actor: KeyActor): Promise<{ key: string; name: string }> {
  const key = await loadManageable(keyId, actor);
  if (key.revokedAt) throw new ValidationError('已撤销的密钥不能再查看明文，请创建新密钥');
  if (!key.keyCipher) {
    throw new ValidationError('该密钥创建于加密存储上线之前，明文已不可恢复；请轮换生成新密钥');
  }
  const plain = decryptSecret(key.keyCipher);
  if (!plain) {
    throw new ValidationError('密钥明文解密失败（服务端 JWT_SECRET 可能已更换），请轮换生成新密钥');
  }
  return { key: plain, name: key.name };
}

/**
 * 彻底删除（R87 用户决定）：与「撤销」不同，行从库中移除，列表不再出现。
 * 历史用量保留但不再归属该密钥（UsageEvent.apiKeyId 外键为 SetNull）。
 */
export async function deleteKey(keyId: string, actor: KeyActor): Promise<void> {
  await loadManageable(keyId, actor);
  await prisma.apiKey.delete({ where: { id: keyId } });
}

export interface KeyUsagePoint {
  day: string;
  calls: number;
}

/** 用量聚合：按日调用次数（近 60 天） */
export async function keyUsage(keyId: string, days = 30, actor?: KeyActor): Promise<{ total: number; points: KeyUsagePoint[] }> {
  if (actor) await loadManageable(keyId, actor);
  else {
    const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key) throw new NotFoundError(`密钥不存在: ${keyId}`);
  }

  const since = new Date(Date.now() - days * 86_400_000);
  // Postgres date_trunc 聚合（AGENTS.md：聚合类 raw SQL 例外，须注释）。
  // 注意：raw SQL 里必须是库表物理列名（snake_case），非 Prisma 字段名。
  const rows = await prisma.$queryRaw<{ day: Date; calls: number }[]>`
    SELECT date_trunc('day', "created_at") AS day, COUNT(*)::int AS calls
    FROM "usage_events"
    WHERE "api_key_id" = ${keyId} AND "created_at" >= ${since}
    GROUP BY 1 ORDER BY 1
  `;
  const total = await prisma.usageEvent.count({ where: { apiKeyId: keyId, createdAt: { gte: since } } });
  return {
    total,
    points: rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), calls: Number(r.calls) })),
  };
}

/** 导出类型（测试用） */
export type { ApiKey };
export const _internal = { maskOf, statusOf };
export type { Prisma };
