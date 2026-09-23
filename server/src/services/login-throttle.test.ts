import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { resetDb, createUser } from '../test-helpers.js';
import * as loginThrottle from './login-throttle.js';
import { config } from '../config.js';

/**
 * F4 登录防暴力：/auth/login 按 IP+邮箱 限流（429 RATE_LIMITED + 人话提示）。
 * 计数窗口与阈值来自 config.loginThrottle；用例直接传 ts 控制时间，不依赖真实等待。
 */

let app: FastifyInstance;
const email = 'brute@t.com';

beforeEach(async () => {
  await resetDb();
  loginThrottle.reset();
  app = await buildServer();
  await app.ready();
  await createUser({ email, password: 'abcd1234' });
});

describe('F4 登录限流：HTTP 行为', () => {
  it('同 IP+邮箱连续密码错误达到阈值后返回 429 RATE_LIMITED（人话 + Retry-After）', async () => {
    const limit = config.loginThrottle.maxAttempts;
    const attempt = () =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'wrong123' } });

    for (let i = 0; i < limit; i++) {
      const res = await attempt();
      expect(res.statusCode, `第 ${i + 1} 次应为 401`).toBe(401);
    }

    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    expect(blocked.json().error.message).toMatch(/次数过多|稍后/);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(config.loginThrottle.maxAttempts).toBe(5);
  });

  it('被限流后即使密码正确也返回 429（窗口内不放行）', async () => {
    for (let i = 0; i < config.loginThrottle.maxAttempts; i++) {
      await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'wrong123' } });
    }
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'abcd1234' } });
    expect(res.statusCode).toBe(429);
  });

  it('成功登录清零计数：随后再错两次仍是 401（未达阈值）', async () => {
    const wrong = { method: 'POST' as const, url: '/api/auth/login', payload: { email, password: 'wrong123' } };
    await app.inject(wrong);
    await app.inject(wrong);

    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'abcd1234' } });
    expect(ok.statusCode).toBe(200);

    const again = await app.inject(wrong);
    expect(again.statusCode).toBe(401);
  });
});

describe('F4 登录限流：计数规则', () => {
  it('按邮箱+IP 分别计数：换 IP 不受影响，同 IP 换邮箱也不受影响', () => {
    const t = 1_000_000;
    const limit = config.loginThrottle.maxAttempts;
    for (let i = 0; i <= limit; i++) loginThrottle.registerFailure(email, '1.1.1.1', t);
    expect(loginThrottle.checkBlocked(email, '1.1.1.1', t).blocked).toBe(true);
    expect(loginThrottle.checkBlocked(email, '2.2.2.2', t).blocked).toBe(false);
    expect(loginThrottle.checkBlocked('other@t.com', '1.1.1.1', t).blocked).toBe(false);
  });

  it('未超阈值不封锁；达到阈值即封锁，窗口过期后重新放行（retryAfterMs 指向窗口末尾）', () => {
    const t = 1_000_000;
    const limit = config.loginThrottle.maxAttempts;

    // 阈值内（少一次）：不封锁
    for (let i = 0; i < limit - 1; i++) loginThrottle.registerFailure(email, '1.1.1.1', t);
    expect(loginThrottle.checkBlocked(email, '1.1.1.1', t).blocked).toBe(false);

    // 用满阈值：封锁，retryAfterMs 指向窗口末尾
    loginThrottle.registerFailure(email, '1.1.1.1', t);
    const blockedNow = loginThrottle.checkBlocked(email, '1.1.1.1', t);
    expect(blockedNow.blocked).toBe(true);
    expect(blockedNow.retryAfterMs).toBeGreaterThan(0);

    const afterWindow = t + blockedNow.retryAfterMs + 1;
    expect(loginThrottle.checkBlocked(email, '1.1.1.1', afterWindow).blocked).toBe(false);
  });

  it('成功登录清零该 key 的计数', () => {
    const t = 1_000_000;
    const limit = config.loginThrottle.maxAttempts;
    for (let i = 0; i <= limit; i++) loginThrottle.registerFailure(email, '1.1.1.1', t);
    loginThrottle.clear(email, '1.1.1.1');
    expect(loginThrottle.checkBlocked(email, '1.1.1.1', t).blocked).toBe(false);
  });

  it('登录成功后不产生限流错误（回归：正常路径无副作用）', async () => {
    const spy = vi.spyOn(loginThrottle, 'registerFailure');
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'abcd1234' } });
    expect(spy).not.toHaveBeenCalled();
  });
});
