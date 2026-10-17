import { describe, it, expect, afterEach } from 'vitest';
import { canEncryptSecret, decryptSecret, encryptSecret } from './key-cipher.js';

/**
 * 密钥明文可逆保护（R86 用户决定：密钥创建后仍可查看/复制）。
 * 契约：AES-256-GCM；密钥由 JWT_SECRET 派生；更换 JWT_SECRET 后历史密文不可解。
 */

const ORIGINAL = process.env.JWT_SECRET;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL;
});

describe('key-cipher', () => {
  it('加密后可无损解回，且密文不含明文', () => {
    process.env.JWT_SECRET = 'secret-one';
    const plain = 'vhk_live_abcdefghijklmnopqrstuvwx';
    const enc = encryptSecret(plain);
    expect(enc).toBeTruthy();
    expect(enc!.startsWith('v1:')).toBe(true);
    expect(enc!).not.toContain(plain);
    expect(decryptSecret(enc!)).toBe(plain);
  });

  it('同一明文两次加密不同（随机 IV）', () => {
    process.env.JWT_SECRET = 'secret-one';
    expect(encryptSecret('same-plain')).not.toBe(encryptSecret('same-plain'));
  });

  it('密文被篡改时解密返回 null（GCM 认证标签）', () => {
    process.env.JWT_SECRET = 'secret-one';
    const parts = encryptSecret('tamper-me')!.split(':');
    parts[3] = Buffer.from('tampered-ciphertext').toString('base64');
    expect(decryptSecret(parts.join(':'))).toBeNull();
  });

  it('更换 JWT_SECRET 后不可解（已写入契约的代价）', () => {
    process.env.JWT_SECRET = 'secret-one';
    const enc = encryptSecret('rotated-secret')!;
    process.env.JWT_SECRET = 'secret-two';
    expect(decryptSecret(enc)).toBeNull();
  });

  it('未配置 JWT_SECRET 时不加密（返回 null，明文不落库）', () => {
    process.env.JWT_SECRET = '';
    expect(canEncryptSecret()).toBe(false);
    expect(encryptSecret('no-secret')).toBeNull();
    expect(decryptSecret('v1:a:b:c')).toBeNull();
  });

  it('非法格式直接判不可解', () => {
    process.env.JWT_SECRET = 'secret-one';
    expect(decryptSecret('not-a-cipher')).toBeNull();
    expect(decryptSecret('v2:a:b:c')).toBeNull();
  });
});
