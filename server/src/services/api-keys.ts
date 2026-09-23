import type { ApiKey, Prisma } from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { hashToken } from '../core/tokens.js';
import { NotFoundError, ValidationError } from '../core/errors.js';
import { isKnownScope, SCOPES, type Scope } from '../mcp/scopes.js';

/**
 * MCP 密钥管理（商业产品计划 §4）。
 * 明文只在创建/轮换响应中出现一次；库中仅存 SHA-256 哈希。
 */

/** 默认有效期 90 天；轮换宽限期 24h */
const DEFAULT_TTL_DAYS = 90;
export const ROTATION_GRACE_HOURS = 24;

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
  created_by: string | null;
  created_at: string;
}

function maskOf(prefix: string): string {
  return `${prefix}${'•'.repeat(8)}`;
}

function statusOf(key: { revokedAt: Date | null; expiresAt: Date | null }): ApiKeyView['status'] {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return 'expired';
  return 'active';
}

function toView(key: ApiKey): ApiKeyView {
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
    created_by: key.createdBy,
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

/** 创建密钥：返回一次性明文 */
export async function createKey(input: CreateKeyInput): Promise<{ key: string; view: ApiKeyView }> {
  if (!input.name?.trim()) throw new ValidationError('密钥名称不能为空');
  const scopes = input.scopes ?? ['context:read'];
  for (const s of scopes) {
    if (!isKnownScope(s)) throw new ValidationError(`未知 scope: ${s}。可用: ${SCOPES.join(' / ')}`);
  }
  // 防过度授权：无 admin scope 时不得包含未知组合之外的越权项（admin 仅显式授予）
  if (input.rateLimit !== undefined && (input.rateLimit < 1 || input.rateLimit > 10_000)) {
    throw new ValidationError('rate_limit 需在 1-10000 之间');
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
      scopes,
      rateLimit: input.rateLimit ?? 300,
      expiresAt: ttlDays === null ? null : new Date(Date.now() + ttlDays * 86_400_000),
      createdBy: input.createdBy,
    },
  });
  return { key: plaintext, view: toView(row) };
}

/** 密钥列表（掩码；不含明文与哈希） */
export async function listKeys(): Promise<ApiKeyView[]> {
  const keys = await prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
  return keys.map(toView);
}

/**
 * 轮换：签发新密钥（同名/同 scope/同限速），旧密钥进入 24h 宽限期
 * （用 expiresAt=now+24h 表达宽限——loadKeyedContext 已按 expiresAt 校验，语义一致且无需新字段）。
 */
export async function rotateKey(keyId: string, operatorId: string): Promise<{ key: string; view: ApiKeyView; previous_grace_until: string }> {
  const old = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!old) throw new NotFoundError(`密钥不存在: ${keyId}`);
  if (old.revokedAt) throw new ValidationError('已撤销的密钥不能轮换，请创建新密钥');

  const graceUntil = new Date(Date.now() + ROTATION_GRACE_HOURS * 3_600_000);
  const created = await createKey({ name: old.name, scopes: old.scopes, rateLimit: old.rateLimit, createdBy: operatorId });

  // 旧密钥有效期压缩到宽限期结束（不晚于原有效期）
  const newExpiry = old.expiresAt && old.expiresAt < graceUntil ? old.expiresAt : graceUntil;
  await prisma.apiKey.update({ where: { id: keyId }, data: { expiresAt: newExpiry } });

  return { ...created, previous_grace_until: newExpiry.toISOString() };
}

/** 撤销：立即失效 */
export async function revokeKey(keyId: string): Promise<void> {
  const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!key) throw new NotFoundError(`密钥不存在: ${keyId}`);
  await prisma.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
}

export interface KeyUsagePoint {
  day: string;
  calls: number;
}

/** 用量聚合：按日调用次数（近 60 天） */
export async function keyUsage(keyId: string, days = 30): Promise<{ total: number; points: KeyUsagePoint[] }> {
  const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!key) throw new NotFoundError(`密钥不存在: ${keyId}`);

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
