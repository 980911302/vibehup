import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';
import { createBug, updateBug } from './bugs.js';
import { createNote, updateNote } from './notes.js';
import { upsertEntityEmbedding } from './embedding.js';
import { config } from '../config.js';

/**
 * 语义索引写路径（卡片 F2）：
 * ① 仅语义文本（标题/步骤/期望/实际、便签内容/标签）变化时重算向量——拖拽改状态/改严重度不打外网；
 * ② DashScope 请求有超时，挂起不阻塞业务主流程（`await` 但内部隔离）。
 * test-setup 全局置 provider=none；本文件用 vi.mock 覆盖为开启态以断言调用次数。
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
        timeoutMs: 50,
      },
    },
  };
});

const DIM = config.embedding.dim;

function vec(head = 0.5): number[] {
  const out = Array.from({ length: DIM }, () => 0);
  out[0] = head;
  return out;
}

/** fetch 成功：DashScope 兼容模式返回 base64 float32 */
function mockFetchOk() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: [{ embedding: vec() }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

/** fetch 挂起：仅在 signal 中止时 reject（模拟真实 fetch 的超时行为） */
function mockFetchHang() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
      }),
  );
}

async function makeProject(slug = 'p1') {
  const p = await prisma.project.create({
    data: { id: `prj_${slug}`, name: `项目${slug}`, slug },
  });
  return p;
}

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
});

describe('F2 语义索引写路径：仅语义文本变化才重算向量', () => {
  it('改状态/优先级（非语义字段）不调用 DashScope', async () => {
    const project = await makeProject();
    const fetchSpy = mockFetchOk();
    const bug = await createBug({ projectId: project.id, title: '登录按钮无反应' });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // 创建时必算

    fetchSpy.mockClear();
    await updateBug(bug.id, { status: 'in_progress', priority: 'high' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('改标题/复现步骤（语义文本）重新调用 DashScope 并更新向量', async () => {
    const project = await makeProject();
    const fetchSpy = mockFetchOk();
    const bug = await createBug({ projectId: project.id, title: '原标题' });

    fetchSpy.mockClear();
    await updateBug(bug.id, { title: '新标题', stepsToReproduce: '打开页面→点击按钮' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const rows = await prisma.$queryRaw<{ c: bigint }[]>`SELECT count(*)::int AS c FROM "embeddings" WHERE "entityId" = ${bug.id}`;
    expect(Number(rows[0].c)).toBe(1);
  });

  it('便签仅置顶（非语义字段）不调用 DashScope', async () => {
    const fetchSpy = mockFetchOk();
    const note = await createNote({ content: '随手记内容 #标签' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockClear();
    await updateNote(note.id, { pinned: true });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('F2 DashScope 请求超时', () => {
  it('请求挂起时按 timeoutMs 中止，upsert 不抛错且不落向量行', async () => {
    const fetchSpy = mockFetchHang();
    const started = Date.now();

    await expect(upsertEntityEmbedding('bug', 'bug_timeout', '内容')).resolves.toBeUndefined();

    expect(Date.now() - started).toBeLessThan(2000);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeDefined();
    expect(init.signal?.aborted).toBe(true);
    const rows = await prisma.$queryRaw<{ c: bigint }[]>`SELECT count(*)::int AS c FROM "embeddings" WHERE "entityId" = 'bug_timeout'`;
    expect(Number(rows[0].c)).toBe(0);
  });

  it('超时不影响业务主流程：改标题返回成功（向量缺失）', async () => {
    const project = await makeProject();
    const bug = await createBug({ projectId: project.id, title: '超时缺陷' });
    mockFetchHang();

    const updated = await updateBug(bug.id, { title: '超时后仍要成功' });
    expect(updated.title).toBe('超时后仍要成功');
  });
});
