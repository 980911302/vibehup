import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 极简 HS256 JWT（access token，15 分钟有效期）。
 * 单机部署用内置 crypto 实现，避免引入额外依赖；
 * refresh token 走 DB 持久化（见 services/auth.ts），可撤销。
 */

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** 签名密钥（access token 与附件签名链接共用，后者以 `asset:` 前缀做域隔离） */
export function getSecret(): string {
  // 优先环境变量；缺省时生成随机密钥（重启后全部失效，适合单机首次启动）
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (!(globalThis as { __jwtSecret?: string }).__jwtSecret) {
    (globalThis as { __jwtSecret?: string }).__jwtSecret = randomBytes(32).toString('hex');
    console.warn('[vibehub] JWT_SECRET 未设置，已生成随机密钥（重启后登录态将失效，生产请显式配置）');
  }
  return (globalThis as { __jwtSecret?: string }).__jwtSecret as string;
}

export interface AccessTokenPayload {
  sub: string;      // user id
  email: string;
  role: string;
}

export function signAccessToken(payload: AccessTokenPayload, expiresInSec = 15 * 60): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(
    JSON.stringify({ ...payload, iat: now, exp: now + expiresInSec }),
  );
  const signature = createHmac('sha256', getSecret()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = createHmac('sha256', getSecret()).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessTokenPayload & {
      exp?: number;
    };
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: payload.sub, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}
