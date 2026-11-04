import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';
import * as memory from './memory.js';

beforeEach(async () => {
  await resetDb();
});

describe('项目记忆（R90）', () => {
  it('只收置顶笔记，项目一句话一并返回', async () => {
    const p = await prisma.project.create({ data: { id: 'prj_mem', name: '记忆', slug: 'mem', description: '一句话说明' } });
    await prisma.note.create({ data: { id: 'n1', projectId: p.id, content: '置顶决策', tags: ['决策'], pinnedAt: new Date('2026-01-01') } });
    await prisma.note.create({ data: { id: 'n2', projectId: p.id, content: '普通笔记', tags: [] } });
    const m = await memory.getProjectMemory(p.id);
    expect(m.project.description).toBe('一句话说明');
    expect(m.decisions.map((d) => d.content)).toEqual(['置顶决策']);
  });

  it('MCP 压缩：最多 3 条、长文截断', async () => {
    const p = await prisma.project.create({ data: { id: 'prj_mem2', name: '记忆2', slug: 'mem2' } });
    for (let i = 0; i < 5; i++) {
      await prisma.note.create({ data: { id: `n${i}`, projectId: p.id, content: 'x'.repeat(400), pinnedAt: new Date(Date.now() + i) } });
    }
    const m = await memory.getProjectMemoryForMcp(p.id);
    expect(m.decisions).toHaveLength(3);
    expect(m.decisions[0].content.length).toBeLessThanOrEqual(301);
  });

  it('无项目 404', async () => {
    await expect(memory.getProjectMemory('nope')).rejects.toThrow(/项目不存在/);
  });
});
