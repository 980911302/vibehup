import { describe, it, expect } from 'vitest';
import { signAssetUrl, verifyAssetSignature, ASSET_URL_BUCKET_SEC } from './asset-sign.js';

/**
 * 附件签名链接（R76 修复：<img> 带不了 Bearer 头，截图全部 401）。
 * 签名 = HMAC(secret, attachmentId + exp)，exp 按时间桶取整——同桶内 URL 稳定，
 * 前端 5s 轮询重复拉列表时图片不重新下载、不闪烁。
 */

function parse(url: string) {
  const u = new URL(url, 'http://x');
  return { path: u.pathname, exp: u.searchParams.get('exp') ?? undefined, sig: u.searchParams.get('sig') ?? undefined };
}

describe('附件签名链接', () => {
  const now = Date.UTC(2026, 8, 23, 10, 0, 0);

  it('签出的链接可被验证通过', () => {
    const { path, exp, sig } = parse(signAssetUrl('/api/attachments/att_a/raw', 'att_a', now));
    expect(path).toBe('/api/attachments/att_a/raw');
    expect(verifyAssetSignature('att_a', exp, sig, now)).toBe(true);
  });

  it('篡改签名、换附件、改过期时间一律拒绝', () => {
    const { exp, sig } = parse(signAssetUrl('/api/attachments/att_a/raw', 'att_a', now));
    expect(verifyAssetSignature('att_a', exp, `${sig}x`, now)).toBe(false);
    expect(verifyAssetSignature('att_b', exp, sig, now)).toBe(false);
    expect(verifyAssetSignature('att_a', String(Number(exp) + 3600), sig, now)).toBe(false);
    expect(verifyAssetSignature('att_a', undefined, undefined, now)).toBe(false);
  });

  it('过期后拒绝', () => {
    const { exp, sig } = parse(signAssetUrl('/api/attachments/att_a/raw', 'att_a', now));
    const afterExpiry = (Number(exp) + 1) * 1000;
    expect(verifyAssetSignature('att_a', exp, sig, afterExpiry)).toBe(false);
  });

  it('有效期至少一个时间桶：签发后 12 小时内仍可用', () => {
    const { exp, sig } = parse(signAssetUrl('/api/attachments/att_a/raw', 'att_a', now));
    expect(verifyAssetSignature('att_a', exp, sig, now + ASSET_URL_BUCKET_SEC * 1000 - 1)).toBe(true);
  });

  it('同一时间桶内重复签发得到同一 URL（轮询不闪烁）', () => {
    const a = signAssetUrl('/api/attachments/att_a/raw', 'att_a', now);
    const b = signAssetUrl('/api/attachments/att_a/raw', 'att_a', now + 60_000);
    expect(b).toBe(a);
  });
});
