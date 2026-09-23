import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';
import * as embeddingService from './embedding.js';
import { config } from '../config.js';

/**
 * 语义检索（卡片 28）：DashScope OpenAI 兼容 /embeddings 客户端。
 * test-setup 全局置 none（写路径测试卫生）；本文件覆盖 config.embedding 为开启态验证客户端本身。
 * mock 的 dim=1024 与库中 vector 列宽一致，dim 变更须同步迁移与本行。
 */
vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      embedding: {
        ...actual.config.embedding,
        provider: 'dashscope' as const,
        apiKey: 'test-key',
        baseUrl: 'https://dashscope.test/v1',
        model: 'test-embed',
        dim: 1024,
        sendDim: true,
        useBase64: true,
        tokenLimit: 100,
      },
    },
  };
});

/** 语义检索（卡片 28）：DashScope OpenAI 兼容 /embeddings 客户端 */

const DIM = config.embedding.dim;

/** 生成长度为 DIM 的向量：前几位为指定值，其余补 0 */
function vec(...head: number[]): number[] {
  const out = Array.from({ length: DIM }, () => 0);
  head.forEach((v, i) => (out[i] = v));
  return out;
}

function floatToBase64Floats(values: number[]): string {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeFloatLE(v, i * 4));
  return buf.toString('base64');
}

function mockFetchOk(embedding: number[] | string, extra: Record<string, unknown> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: [{ embedding }], ...extra }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
});

describe('embedding 配置（卡片 28）', () => {
  it('mock 开启态：provider=dashscope 且有 key 时已启用', () => {
    const cfg = embeddingService.getEmbeddingConfig();
    expect(cfg.provider).toBe('dashscope');
    expect(cfg.apiKey.length).toBeGreaterThan(0);
    expect(embeddingService.isEmbeddingEnabled()).toBe(true);
    expect(DIM).toBe(1024);
  });
});

describe('embedText（卡片 28）', () => {
  it('按 DashScope 兼容模式发请求：model + dimensions + base64 encoding_format', async () => {
    const spy = mockFetchOk(vec(0.1, 0.2, 0.3));
    const got = await embeddingService.embedText('你好世界');
    expect(got.slice(0, 3)).toEqual([0.1, 0.2, 0.3]);
    expect(got).toHaveLength(DIM);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/embeddings');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(config.embedding.model);
    if (config.embedding.sendDim) expect(body.dimensions).toBe(config.embedding.dim);
    if (config.embedding.useBase64) expect(body.encoding_format).toBe('base64');
    expect((init.headers as Record<string, string>).authorization).toContain('Bearer');
  });

  it('base64 响应正确解码为浮点数组', async () => {
    mockFetchOk(floatToBase64Floats(vec(1.5, -2.5, 0.0)));
    const got = await embeddingService.embedText('x');
    expect(got).toHaveLength(DIM);
    expect(got[0]).toBeCloseTo(1.5, 4);
    expect(got[1]).toBeCloseTo(-2.5, 4);
  });

  it('HTTP 非 2xx 抛出带状态码的错误', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 401 }));
    await expect(embeddingService.embedText('x')).rejects.toThrow(/401| DashScope | embedding/i);
  });

  it('provider=none 时 embedText 抛错（不应被调用）', async () => {
    if (embeddingService.isEmbeddingEnabled()) return; // 仅关闭态执行本断言
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(embeddingService.embedText('x')).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('超长文本按 token 上限截断后再发送', async () => {
    const spy = mockFetchOk(vec(0.1));
    await embeddingService.embedText('长'.repeat(50_000));
    const body = JSON.parse((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(String(body.input).length).toBeLessThanOrEqual(config.embedding.tokenLimit);
  });
});

describe('upsertEntityEmbedding + semanticSearch（卡片 28）', () => {
  it('upsert 落一行（含 dimension 校验通过的向量）', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: vec(0.5, 0.5) }] }), { status: 200 }),
    );
    await embeddingService.upsertEntityEmbedding('note', 'nte_x', '内容');
    const rows = await prisma.$queryRaw<{ c: bigint }[]>`SELECT count(*)::int AS c FROM "embeddings" WHERE "entityId" = 'nte_x'`;
    expect(Number(rows[0].c)).toBe(1);
  });

  it('重复 upsert 同行更新（唯一约束 entityType+entityId+model 不冲突）', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: vec(0.5, 0.5) }] }), { status: 200 }),
    );
    await embeddingService.upsertEntityEmbedding('note', 'nte_dup', '第一版');
    await embeddingService.upsertEntityEmbedding('note', 'nte_dup', '第二版');
    const rows = await prisma.$queryRaw<{ c: bigint }[]>`SELECT count(*)::int AS c FROM "embeddings" WHERE "entityId" = 'nte_dup'`;
    expect(Number(rows[0].c)).toBe(1);
  });

  it('similarEntities 按 cosine 距离排序，且过滤低相关（>0.5）命中', async () => {
    // 用带方向的向量（前两维不同模式制造真实角度），全常量向量互相平行无法测距离
    const pattern = (a: number, b: number) => {
      const v = vec();
      v[0] = a;
      v[1] = b;
      return v;
    };
    const mkVec = (vals: number[]) => `[${vals.join(',')}]`;
    // e1 与查询同向（d≈0），e3 中等相关（d≈0.04），e2 反向（d≈1.7，应被阈值过滤）
    await prisma.$executeRawUnsafe(
      `INSERT INTO "embeddings" (id, "entityType", "entityId", model, dim, embedding, "created_at", "updated_at")
       VALUES ('e1','note','nte_a','m', $1, $2::vector, now(), now())`, DIM, mkVec(pattern(1, 1)),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "embeddings" (id, "entityType", "entityId", model, dim, embedding, "created_at", "updated_at")
       VALUES ('e2','note','nte_b','m', $1, $2::vector, now(), now())`, DIM, mkVec(pattern(-1, 0)),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "embeddings" (id, "entityType", "entityId", model, dim, embedding, "created_at", "updated_at")
       VALUES ('e3','note','nte_c','m', $1, $2::vector, now(), now())`, DIM, mkVec(pattern(1, 0.5)),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: pattern(1, 0.9) }] }), { status: 200 }),
    );
    const hits = await embeddingService.similarEntities('查询词', ['note'], 5);
    expect(hits.map((h) => h.entityId)).toEqual(['nte_a', 'nte_c']);
    expect(hits.every((h) => h.distance < 0.5)).toBe(true);
  });
});
