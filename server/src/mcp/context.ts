import type { ApiKey } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { hashToken } from '../core/tokens.js';
import { LOCAL_SCOPES, type Scope } from './scopes.js';

/**
 * MCP 上下文（步骤 03 §3.4 契约）。
 * - local：stdio 无密钥（单机信任模型）= 全量 scope
 * - keyed：携带 vhk_ 密钥 → 哈希查库 → 校验撤销/过期 → 解析 scopes
 * 密钥无效时抛 McpContextError（启动即失败，绝不静默降权）；
 * 进程退出由 mcp-entry.ts 统一处理。
 */

export interface McpContext {
  mode: 'local' | 'keyed';
  apiKeyId: string | null;
  scopes: ReadonlySet<string>;
  /** 审计标签：'local' 或 'cursor-main(vhk_live_7Kd9)' */
  actorLabel: string;
  /** 看板上显示的操作人名（密钥名，如「Cursor-验证」）；R83 起记在流转记录上 */
  actorName?: string;
}

/** MCP 写入的操作人：看板据此显示「谁在处理」 */
export function mcpActor(ctx: McpContext): { type: 'ai'; id: string | null; name: string } {
  return { type: 'ai', id: ctx.apiKeyId, name: ctx.actorName ?? (ctx.mode === 'local' ? '本地 AI' : 'AI') };
}

export class McpContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpContextError';
  }
}

export async function resolveMcpContext(env: NodeJS.ProcessEnv = process.env): Promise<McpContext> {
  const rawKey = env.VIBEHUB_API_KEY?.trim();
  if (!rawKey) {
    return { mode: 'local', apiKeyId: null, scopes: LOCAL_SCOPES, actorLabel: 'local', actorName: '本地 AI' };
  }
  return loadKeyedContext(rawKey);
}

/** 校验密钥时连带取创建人状态（禁用账号的密钥随之停用） */
const WITH_CREATOR_STATUS = { creator: { select: { status: true } } } as const;

/**
 * 从明文密钥加载上下文（stdio 与 SSE 双传输共用）。
 * 密钥无效抛 McpContextError——调用方决定退出（stdio）或 401（SSE）。
 */
export async function loadKeyedContext(rawKey: string): Promise<McpContext> {
  const keyHash = hashToken(rawKey);
  // keyHash 未建唯一索引（schema 无 @unique），用 findFirst；SHA-256 碰撞在密码学上可忽略
  const key = await prisma.apiKey.findFirst({ where: { keyHash }, include: WITH_CREATOR_STATUS });
  return toKeyedContext(key);
}

/**
 * 复核已加载的 keyed 上下文（R76）：SSE 长连接只在握手时加载一次上下文，
 * 每次工具调用前按 ID 重查——握手后被撤销 / 过期 / 创建人被禁用的密钥立即失效。
 */
export async function refreshKeyedContext(ctx: McpContext): Promise<McpContext> {
  if (ctx.mode !== 'keyed' || !ctx.apiKeyId) return ctx;
  const key = await prisma.apiKey.findUnique({ where: { id: ctx.apiKeyId }, include: WITH_CREATOR_STATUS });
  return toKeyedContext(key);
}

function toKeyedContext(key: (ApiKey & { creator: { status: string } | null }) | null): McpContext {
  if (!key) {
    throw new McpContextError('密钥不存在，请在 Web 端「密钥」页检查或重新创建');
  }
  if (key.revokedAt) {
    throw new McpContextError('密钥已被撤销，请在 Web 端「密钥」页处理');
  }
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
    throw new McpContextError('密钥已过期，请在 Web 端「密钥」页续期');
  }
  // 禁用是可逆的（恢复账号后密钥随之恢复），故只校验不吊销；移除成员则直接吊销（见 users.removeUser）
  if (key.creator?.status === 'disabled') {
    throw new McpContextError('密钥创建人的账号已被禁用，密钥随之停用；如需继续使用请联系管理员');
  }

  return {
    mode: 'keyed',
    apiKeyId: key.id,
    scopes: new Set<string>(key.scopes),
    actorLabel: `${key.name}(${key.keyPrefix})`,
    actorName: key.name,
  };
}

/** 便捷判断（供工具 handler 使用） */
export function ctxHas(ctx: McpContext, scope: Scope): boolean {
  return ctx.scopes.has(scope) || ctx.scopes.has('admin');
}
