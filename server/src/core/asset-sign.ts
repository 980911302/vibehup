import { createHmac, timingSafeEqual } from 'node:crypto';
import { getSecret } from './jwt.js';

/**
 * 附件签名链接（R76）。
 * <img> 与「新标签页打开原图」带不了 Authorization 头，/raw 挂在登录守卫下时截图全部 401；
 * 改由序列化层签发 exp+sig，/raw 验签放行（签名或 Bearer 二选一，见 routes/attachments.ts）。
 *
 * exp 按时间桶取整：同桶内 URL 不变（前端 5s 轮询重复拉列表时图片不重新下载、不闪烁），
 * 有效期落在 1~2 个桶之间。
 */

export const ASSET_URL_BUCKET_SEC = 12 * 60 * 60;

function sign(attachmentId: string, exp: number): string {
  return createHmac('sha256', getSecret()).update(`asset:${attachmentId}:${exp}`).digest('base64url');
}

/** 给本地代理地址追加 exp/sig 查询参数 */
export function signAssetUrl(path: string, attachmentId: string, now = Date.now()): string {
  const bucket = Math.floor(now / 1000 / ASSET_URL_BUCKET_SEC);
  const exp = (bucket + 2) * ASSET_URL_BUCKET_SEC;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}exp=${exp}&sig=${sign(attachmentId, exp)}`;
}

/** 校验签名：附件 ID、过期时间任一被改动或已过期均不通过 */
export function verifyAssetSignature(
  attachmentId: string,
  exp: string | undefined,
  sig: string | undefined,
  now = Date.now(),
): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  const expSec = Number(exp);
  if (expSec * 1000 < now) return false;
  const expected = Buffer.from(sign(attachmentId, expSec));
  const actual = Buffer.from(sig);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
