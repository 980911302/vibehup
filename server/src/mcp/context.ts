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
    return { mode: 'local', apiKeyId: null, scopes: LOCAL_SCOPES, actorLabel: 'local' };
  }
  return loadKeyedContext(rawKey);
}

/**
 * 从明文密钥加载上下文（stdio 与 SSE 双传输共用）。
 * 密钥无效抛 McpContextError——调用方决定退出（stdio）或 401（SSE）。
 */
export async function loadKeyedContext(rawKey: string): Promise<McpContext> {
  const keyHash = hashToken(rawKey);
  // keyHash 未建唯一索引（schema 无 @unique），用 findFirst；SHA-256 碰撞在密码学上可忽略
  const key = await prisma.apiKey.findFirst({ where: { keyHash } });
  if (!key) {
    throw new McpContextError('密钥不存在，请在 Web 端「密钥」页检查或重新创建');
  }
  if (key.revokedAt) {
    throw new McpContextError('密钥已被撤销，请在 Web 端「密钥」页处理');
  }
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
    throw new McpContextError('密钥已过期，请在 Web 端「密钥」页续期');
  }

  const scopes = new Set<string>(key.scopes);
  return {
    mode: 'keyed',
    apiKeyId: key.id,
    scopes,
    actorLabel: `${key.name}(${key.keyPrefix})`,
  };
}

/** 便捷判断（供工具 handler 使用） */
export function ctxHas(ctx: McpContext, scope: Scope): boolean {
  return ctx.scopes.has(scope) || ctx.scopes.has('admin');
}
