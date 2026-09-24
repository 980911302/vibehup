import type { FastifyInstance } from 'fastify';
import { randomBytes, createHash } from 'node:crypto';
import { prisma } from './core/prisma.js';

/** 测试基建（步骤 05 §5.2）：resetDb / createUser / authHeaders / createApiKey */

/** TRUNCATE 全表（含外键级联），比逐表 deleteMany 快且干净 */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "bug_comments","bugs","attachments","saved_views","bug_templates","notes","tasks","usage_events","refresh_tokens","api_keys","projects","users","embeddings","skill_files","skills" RESTART IDENTITY CASCADE',
  );
}

export async function createUser(overrides: {
  email?: string;
  password?: string;
  name?: string;
  role?: string;
  status?: string;
} = {}) {
  const email = overrides.email ?? `u_${randomBytes(6).toString('hex')}@t.com`;
  const password = overrides.password ?? 'abcd1234';
  // 直接走 service（register 含首位 owner 逻辑；指定 role/status 时先建再改）
  const { register } = await import('./services/auth.js');
  const result = await register({ email, password, name: overrides.name ?? '测试用户' });
  if (overrides.role || overrides.status) {
    await prisma.user.update({
      where: { id: result.user.id },
      data: {
        ...(overrides.role ? { role: overrides.role } : {}),
        ...(overrides.status ? { status: overrides.status } : {}),
      },
    });
  }
  return { ...result, email, password };
}

/** 注册+登录，返回带 Authorization 的头（role/status 变更后必须重新登录拿新令牌） */
export async function authHeaders(
  app: FastifyInstance,
  email = 'owner@t.com',
  password = 'abcd1234',
): Promise<Record<string, string>> {
  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password, name: '测试用户' },
  });
  if (reg.statusCode !== 201) {
    // 已存在则登录
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });
    return { authorization: `Bearer ${login.json().access_token}` };
  }
  return { authorization: `Bearer ${reg.json().access_token}` };
}

/** 创建 API Key（模拟 Web 端密钥页行为；返回明文与 ID） */
export async function createApiKey(overrides: {
  name?: string;
  scopes?: string[];
  rateLimit?: number;
  createdBy?: string | null;
} = {}): Promise<{ key: string; id: string; prefix: string }> {
  const key = `vhk_test_${randomBytes(24).toString('base64url')}`;
  const salt = randomBytes(16).toString('base64');
  const keyHash = createHash('sha256').update(key).digest('hex');
  const row = await prisma.apiKey.create({
    data: {
      id: `key_${randomBytes(6).toString('hex')}`,
      name: overrides.name ?? 'test-key',
      keyPrefix: key.slice(0, 13),
      keyHash,
      salt,
      scopes: overrides.scopes ?? ['context:read'],
      rateLimit: overrides.rateLimit ?? 300,
      createdBy: overrides.createdBy ?? null,
    },
  });
  return { key, id: row.id, prefix: row.keyPrefix };
}
