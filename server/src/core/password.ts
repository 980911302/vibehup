import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const N = 16384, r = 8, p = 1;

/**
 * util.promisify 不支持带可选中间参数（options）的 scrypt，手动包装。
 */
function scryptAsync(password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** scrypt 密码哈希：格式 scrypt$N$r$p$salt$hash，兼容 Node 内置实现，无原生依赖 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), derived.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scryptAsync(password, salt, expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** 密码强度：至少 8 位，包含字母与数字 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return '密码至少 8 位';
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return '密码需同时包含字母和数字';
  return null;
}
