import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSecret } from './jwt.js';

/**
 * 签名上传授权（R84）：MCP 的 create_upload_url 签发，PUT /api/uploads?token=… 验签后落盘。
 * 让 AI 用 curl 把本地文件直接传上来——文件内容不经过对话（不占 token、不会被模型抄错）。
 *
 * 无状态令牌：授权内容（项目/缺陷/文件名/类型/上传者/密钥）编码在令牌里，
 * HMAC 以 `upload:` 前缀与 JWT 共用密钥做域隔离（同 asset-sign 的做法）。
 * 10 分钟有效、只能用一次：已用 nonce 记在进程内（单容器部署成立），过期即清理。
 */

export const UPLOAD_GRANT_TTL_SEC = 600;

export interface UploadGrantInput {
  projectId: string;
  entityType: 'bug' | 'general';
  entityId: string | null;
  fileName: string;
  fileType: string;
  /** 附件归属（我的文件 / AI 产物标识）：密钥 ID 或本地上下文标签 */
  uploadedBy: string | null;
  /** 签发它的密钥：上传时复核，撤销/降权即失效；stdio 本地全权为 null */
  apiKeyId: string | null;
}

export interface UploadGrant extends UploadGrantInput {
  exp: number;
  nonce: string;
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(`upload:${payload}`).digest('base64url');
}

export function signUploadGrant(input: UploadGrantInput, now = Date.now()): string {
  const grant: UploadGrant = {
    ...input,
    exp: Math.floor(now / 1000) + UPLOAD_GRANT_TTL_SEC,
    nonce: randomBytes(9).toString('base64url'),
  };
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** 验签 + 未过期；是否已用过由 consumeUploadGrant 判定 */
export function verifyUploadGrant(token: string, now = Date.now()): UploadGrant | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(token.slice(dot + 1));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as UploadGrant;
    return grant.exp * 1000 >= now ? grant : null;
  } catch {
    return null;
  }
}

const usedNonces = new Map<string, number>();

/** 登记一次性使用：已用过返回 false（同一链接重放 / 并发重复提交） */
export function consumeUploadGrant(grant: UploadGrant, now = Date.now()): boolean {
  for (const [nonce, expMs] of usedNonces) if (expMs < now) usedNonces.delete(nonce);
  if (usedNonces.has(grant.nonce)) return false;
  usedNonces.set(grant.nonce, grant.exp * 1000);
  return true;
}
