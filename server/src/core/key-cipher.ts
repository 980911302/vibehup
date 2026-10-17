import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

/**
 * 密钥明文的可逆保护（R87 用户决定：密钥创建后仍可查看/复制）。
 *
 * 契约背景：自 R13 起库中只存 SHA-256 哈希、明文只在创建/轮换响应里出现一次。
 * 用户要求「创建后还能复制查看」，因此新增一列存**密文**（不是明文）：
 * - 算法 AES-256-GCM（带认证标签，篡改可检出）
 * - 密钥由 `JWT_SECRET` 经 SHA-256 加固定上下文派生（不引入新环境变量）
 * - 密文格式 `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`
 *
 * 已知边界（写进 AGENTS.md §5）：**更换 JWT_SECRET 会让历史密文不可解**，
 * 此时该密钥只能轮换重签；这是「随时可查看」换来的必然代价。
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const CONTEXT = 'vibehub:api-key:v1';

/** 读环境变量优先于 config：测试用例常在 import 之后才设置 JWT_SECRET */
function currentSecret(): string {
  return process.env.JWT_SECRET ?? config.jwtSecret ?? '';
}

/** 当前环境能否加密保存明文（未配置 JWT_SECRET 时不能） */
export function canEncryptSecret(): boolean {
  return currentSecret().length > 0;
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(`${CONTEXT}\u0000${secret}`).digest();
}

/** 加密明文密钥；未配置 JWT_SECRET 时返回 null（调用方按「明文不可恢复」处理） */
export function encryptSecret(plain: string): string | null {
  const secret = currentSecret();
  if (!secret) return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** 解密；格式不符 / 密钥已更换 / 被篡改一律返回 null（不抛，交由调用方给人话错误） */
export function decryptSecret(payload: string): string | null {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const secret = currentSecret();
  if (!secret) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
