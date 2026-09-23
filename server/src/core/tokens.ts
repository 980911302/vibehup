import { randomBytes, createHash } from 'node:crypto';
import { ids } from './ids.js';

/** 不透明 refresh token：随机 32 字节，DB 仅存 SHA-256 哈希 */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionId(): string {
  return ids.attachment().replace('att_', 'ses_');
}
