import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../core/prisma.js';
import { resetDb } from '../test-helpers.js';
import { countAttachments, countAttachmentsFor } from './attachments.js';
import { createBug, getBugBoard, listBugs } from './bugs.js';
import { createNote, listNotes, listNoteTags } from './notes.js';
import { listTasks } from './tasks.js';

/**
 * 列表查询效率（R78 性能加固）：
 * ① 附件计数批量化——原本「N 条实体 = N 次 count 查询」，现为一次 groupBy；
 * ② 便签标签统计只取 tags 列（不把 content 全表读进内存）；
 * ③ 计数结果必须与逐条计数完全一致（行为不变的硬约束）。
 */

/**
 * 计数查询 spy：vi.spyOn 默认把方法替换为返回 undefined 的桩（断言通过但被测代码被弄坏），
 * 而 spy 的返回值就是替换后的函数——直接在 mockImplementation 里调 spy 会自递归。
 * 因此显式保存原函数引用后再替换。本轮两种坑都踩到了。
 */
function spyMethod<T extends object, K extends keyof T>(obj: T, key: K) {
  const original = obj[key] as unknown as (...args: unknown[]) => unknown;
  const spy = vi.fn((...args: unknown[]) => original.apply(obj, args));
  (obj as Record<string, unknown>)[key as string] = spy as unknown;
  return spy;
}

async function makeProject(slug = 'perf') {
  return prisma.project.create({ data: { id: `prj_${slug}`, name: '性能项目', slug } });
}

/** 造 n 条附件挂到实体上 */
async function attach(projectId: string, entityType: 'bug' | 'note' | 'task', entityId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await prisma.attachment.create({
      data: {
        id: `att_${entityType}_${entityId}_${i}`,
        projectId,
        entityType,
        entityId,
        fileName: `shot${i}.png`,
        fileType: 'image/png',
        fileSize: 1024,
        storagePath: `attachments/${entityType}_${entityId}_${i}.png`,
        uploadedBy: 'human',
      },
    });
  }
}

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
});

describe('附件计数批量化', () => {
  it('countAttachmentsFor 一次查询返回多条实体的计数（与逐条计数一致）', async () => {
    const p = await makeProject();
    const b1 = await createBug({ projectId: p.id, title: '一图' });
    const b2 = await createBug({ projectId: p.id, title: '三图' });
    const b3 = await createBug({ projectId: p.id, title: '零图' });
    await attach(p.id, 'bug', b1.id, 1);
    await attach(p.id, 'bug', b2.id, 3);

    const batchSpy = spyMethod(prisma.attachment, 'findMany');
    const map = await countAttachmentsFor('bug', [b1.id, b2.id, b3.id]);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy.mock.calls[0][0]).toMatchObject({ select: { entityId: true } });

    expect(map.get(b1.id)).toBe(1);
    expect(map.get(b2.id)).toBe(3);
    expect(map.get(b3.id) ?? 0).toBe(0); // 无附件实体不出现在 Map，调用方按 0 处理
    // 与单条计数完全一致
    expect(map.get(b2.id)).toBe(await countAttachments('bug', b2.id));
  });

  it('空 id 列表不发查询', async () => {
    const spy = spyMethod(prisma.attachment, 'findMany');
    const map = await countAttachmentsFor('bug', []);
    expect(map.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('只统计指定 entityType（不串到 note/task）', async () => {
    const p = await makeProject('mixed');
    const bug = await createBug({ projectId: p.id, title: '混合' });
    const note = await createNote({ content: '同类 id 干扰' });
    await attach(p.id, 'bug', bug.id, 2);
    await attach(p.id, 'note', note.id, 5);
    const map = await countAttachmentsFor('bug', [bug.id, note.id]);
    expect(map.get(bug.id)).toBe(2);
    expect(map.get(note.id) ?? 0).toBe(0); // note 的 5 条不计入 bug 查询
  });

  it('看板不再逐条查附件计数：N 条缺陷只发一次批量查询', async () => {
    const p = await makeProject('board');
    const bugs = [];
    for (let i = 0; i < 8; i++) bugs.push(await createBug({ projectId: p.id, title: `缺陷 ${i}` }));
    for (const b of bugs.slice(0, 3)) await attach(p.id, 'bug', b.id, 1);

    const countSpy = spyMethod(prisma.attachment, 'count');
    const listSpy = spyMethod(prisma.attachment, 'findMany');
    const board = await getBugBoard(p.id);

    expect(countSpy).not.toHaveBeenCalled();
    expect(listSpy).toHaveBeenCalledTimes(1); // 8 条缺陷只发一次附件查询
    expect(board.open).toHaveLength(8);
    expect(board.open.find((b) => b.id === bugs[0].id)?.attachmentCount).toBe(1);
    expect(board.open.find((b) => b.id === bugs[7].id)?.attachmentCount).toBe(0);
  });

  it('缺陷列表同样批量（总数与逐条一致）', async () => {
    const p = await makeProject('list');
    const a = await createBug({ projectId: p.id, title: 'A' });
    const b = await createBug({ projectId: p.id, title: 'B' });
    await attach(p.id, 'bug', b.id, 2);

    const countSpy = spyMethod(prisma.attachment, 'count');
    const res = await listBugs({ projectId: p.id });
    expect(countSpy).not.toHaveBeenCalled();
    expect(res.items.find((i) => i.id === a.id)?.attachmentCount).toBe(0);
    expect(res.items.find((i) => i.id === b.id)?.attachmentCount).toBe(2);
  });

  it('任务列表同样批量', async () => {
    const p = await makeProject('task');
    const t = await prisma.task.create({ data: { id: 'tsk_1', projectId: p.id, title: '任务' } });
    await attach(p.id, 'task', t.id, 4);
    const countSpy = spyMethod(prisma.attachment, 'count');
    const tasks = await listTasks({ projectId: p.id });
    expect(countSpy).not.toHaveBeenCalled();
    expect(tasks.find((x) => x.id === t.id)?.attachmentCount).toBe(4);
  });

  it('便签列表同样批量', async () => {
    const n1 = await createNote({ content: '便签一' });
    const n2 = await createNote({ content: '便签二' });
    const p = await makeProject('note');
    await attach(p.id, 'note', n2.id, 2);

    const countSpy = spyMethod(prisma.attachment, 'count');
    const notes = await listNotes({ includeArchived: true, limit: 50 });
    expect(countSpy).not.toHaveBeenCalled();
    expect(notes.find((x) => x.id === n1.id)?.attachmentCount).toBe(0);
    expect(notes.find((x) => x.id === n2.id)?.attachmentCount).toBe(2);
  });
});

describe('便签标签统计', () => {
  it('只 select tags 列（不把 content 读进内存）+ 计数正确', async () => {
    await createNote({ content: '内容不该被读取', tags: ['alpha', 'beta'] });
    await createNote({ content: '再来一条', tags: ['alpha'] });

    const spy = spyMethod(prisma.note, 'findMany');
    const tags = await listNoteTags();
    expect(spy).toHaveBeenCalledTimes(1);

    // 只取 tags：避免整表 content 进内存
    const arg = spy.mock.calls[0][0] as { select?: Record<string, unknown> };
    expect(arg.select).toEqual({ tags: true });
    expect(arg.select).not.toHaveProperty('content');

    expect(tags).toEqual([
      { tag: 'alpha', count: 2 },
      { tag: 'beta', count: 1 },
    ]);
  });
});
