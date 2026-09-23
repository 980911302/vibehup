import { describe, it, expect, beforeEach } from 'vitest';
import type { Note } from '@prisma/client';
import { resetDb } from '../test-helpers.js';
import * as notesService from './notes.js';
import { serializeNote } from '../core/serialize.js';

/** 随手记置顶能力（卡片 27）：序列化输出 / 切换语义 / 浮顶排序 */

function baseNote(overrides: Partial<Note> = {}): Note {
  const t = new Date('2026-09-22T09:00:00.000Z');
  return {
    id: 'n_test',
    projectId: null,
    content: '内容',
    tags: [],
    isArchived: false,
    pinnedAt: null,
    createdBy: null,
    createdAt: t,
    updatedAt: t,
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDb();
});

describe('随手记置顶（卡片 27）', () => {
  it('serializeNote 输出 pinned_at：置顶时间为 ISO 字符串', () => {
    const serialized = serializeNote({ ...baseNote(), pinnedAt: new Date('2026-09-22T10:00:00.000Z') });
    expect(serialized.pinned_at).toBe('2026-09-22T10:00:00.000Z');
  });

  it('serializeNote 未置顶时 pinned_at 为 null', () => {
    expect(serializeNote(baseNote()).pinned_at).toBeNull();
  });

  it('updateNote pinned=true 落 pinned_at；pinned=false 清除', async () => {
    const n = await notesService.createNote({ content: '置顶我' });
    expect(n.pinnedAt).toBeNull();
    const pinned = await notesService.updateNote(n.id, { pinned: true });
    expect(pinned.pinnedAt).not.toBeNull();
    const unpinned = await notesService.updateNote(n.id, { pinned: false });
    expect(unpinned.pinnedAt).toBeNull();
  });

  it('updateNote 的 pinned 切换与内容编辑互不干扰', async () => {
    const n = await notesService.createNote({ content: '原文' });
    const edited = await notesService.updateNote(n.id, { content: '改过的内容' });
    expect(edited.content).toBe('改过的内容');
    expect(edited.pinnedAt).toBeNull();
  });

  it('listNotes 置顶便签排最前，其余按创建时间倒序', async () => {
    // timestamp(3) 毫秒精度：同毫秒创建的记录 created_at 相同会导致排序不确定，逐条间隔确保可区分
    const oldest = await notesService.createNote({ content: '最旧便签' });
    await new Promise((r) => setTimeout(r, 15));
    const newer = await notesService.createNote({ content: '新便签' });
    await new Promise((r) => setTimeout(r, 15));
    const newest = await notesService.createNote({ content: '最新便签' });
    await notesService.updateNote(oldest.id, { pinned: true });
    const list = await notesService.listNotes({});
    expect(list.map((n) => n.id)).toEqual([oldest.id, newest.id, newer.id]);
  });

  it('多条置顶时按 pinned_at 倒序浮顶', async () => {
    const a = await notesService.createNote({ content: 'A' });
    const b = await notesService.createNote({ content: 'B' });
    await notesService.updateNote(b.id, { pinned: true });
    await new Promise((r) => setTimeout(r, 20));
    await notesService.updateNote(a.id, { pinned: true });
    const list = await notesService.listNotes({});
    expect(list.map((n) => n.id)).toEqual([a.id, b.id]);
  });
});
