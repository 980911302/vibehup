import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import { buildServer } from '../index.js';
import { resetDb, createUser } from '../test-helpers.js';

/**
 * F5 第二项：访问日志脱敏——`/api/events?token=<JWT>` 不能把可用令牌明文写进日志。
 * 用独立 Fastify 实例（pino 写到内存流）捕真实日志行，而非断言序列化器本身。
 */

let app: FastifyInstance;
const lines: string[] = [];

beforeEach(async () => {
  await resetDb();
  lines.length = 0;
  const sink = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  app = await buildServer({ loggerStream: sink });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('F5 访问日志脱敏', () => {
  it('SSE 请求的 token 查询参数被替换为 [已脱敏]，不落 JWT 明文', async () => {
    await app.inject({ method: 'GET', url: '/api/events?token=eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIGNATURE' });
    const joined = lines.join('\n');
    expect(joined).toContain('/api/events');
    expect(joined).toContain('[已脱敏]');
    expect(joined).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(joined).not.toContain('PAYLOAD.SIGNATURE');
  });

  it('普通请求的 URL 与关键字段仍完整（脱敏不过度）', async () => {
    const u = await createUser({ email: 'log@t.com' });
    await app.inject({ method: 'GET', url: '/api/health' });
    const joined = lines.join('\n');
    expect(joined).toContain('/api/health');
    expect(joined).toContain('"method":"GET"');
    expect(u.email).toBe('log@t.com'); // 静默使用，避免未使用变量告警
  });
});
