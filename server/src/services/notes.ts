import type { Note, Prisma } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { buildSearchIndex, matchIndex } from '../core/search.js';
import { eventBus } from '../core/events.js';
import { NotFoundError } from '../core/errors.js';
import { countAttachments } from './attachments.js';
import { upsertEntityEmbedding, deleteEntityEmbedding } from './embedding.js';

/**
 * Note.tags 为 PostgreSQL 原生 String[]（v2 起）。
 * parseTags 保留兼容历史 JSON 字符串数据；serializeTags 统一清洗（trim/去空/上限 20）。
 */
export function parseTags(raw: string[] | string | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function serializeTags(tags: string[] | undefined): string[] {
  return (tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 20);
}

export interface NoteWithMeta extends Note {
  tagList: string[];
  attachmentCount: number;
}

export async function createNote(input: {
  projectId?: string | null;
  content: string;
  tags?: string[];
  isArchived?: boolean;
}): Promise<Note> {
  const note = await prisma.note.create({
    data: {
      id: ids.note(),
      projectId: input.projectId ?? null,
      content: input.content,
      tags: serializeTags(input.tags),
      isArchived: input.isArchived ?? false,
    },
  });
  eventBus.publish({ type: 'note.created', projectId: note.projectId, noteId: note.id });
  await upsertEntityEmbedding('note', note.id, noteEmbeddingText(note));
  return note;
}

/** 便签向量化文本：内容 + 标签 */
function noteEmbeddingText(note: { content: string; tags: string[] | string | null }): string {
  return `${note.content} ${parseTags(note.tags).join(' ')}`;
}

export async function updateNote(
  noteId: string,
  patch: { content?: string; tags?: string[]; isArchived?: boolean; projectId?: string | null; pinned?: boolean },
): Promise<Note> {
  const existing = await getNote(noteId);
  const data: Prisma.NoteUncheckedUpdateInput = {};
  if (patch.content !== undefined) data.content = patch.content;
  if (patch.tags !== undefined) data.tags = serializeTags(patch.tags);
  if (patch.isArchived !== undefined) data.isArchived = patch.isArchived;
  if (patch.projectId !== undefined) data.projectId = patch.projectId;
  // pinned 为置顶开关：true 写入当前时间，false 清除（nulls last 由排序处理）
  if (patch.pinned !== undefined) data.pinnedAt = patch.pinned ? new Date() : null;

  const note = await prisma.note.update({ where: { id: noteId }, data });
  eventBus.publish({ type: 'note.updated', projectId: note.projectId, noteId: note.id });
  // 语义文本（内容+标签）未变则跳过——仅置顶/归档不打 DashScope（卡片 F2）
  const nextEmbeddingText = noteEmbeddingText(note);
  if (nextEmbeddingText !== noteEmbeddingText(existing)) {
    await upsertEntityEmbedding('note', note.id, nextEmbeddingText);
  }
  return note;
}

export async function getNote(noteId: string): Promise<Note> {
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note) throw new NotFoundError(`便签不存在: ${noteId}`);
  return note;
}

export async function listNotes(query: {
  projectId?: string | null;
  tag?: string;
  q?: string;
  includeArchived?: boolean;
  limit?: number;
} = {}): Promise<NoteWithMeta[]> {
  const where: Prisma.NoteWhereInput = {};
  // projectId 为 undefined 时查全部；为 null 时仅查全局便签；为字符串时查该项目
  if (query.projectId !== undefined) where.projectId = query.projectId;
  if (!query.includeArchived) where.isArchived = false;

  let items = await prisma.note.findMany({
    where,
    // 置顶浮顶（pinned_at 倒序，未置顶垫底），其余按创建时间倒序
    orderBy: [{ pinnedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 500,
  });
  if (query.tag?.trim()) {
    const tag = query.tag.trim().toLowerCase();
    items = items.filter((n) => parseTags(n.tags).some((t) => t.toLowerCase() === tag));
  }
  if (query.q?.trim()) {
    const q = query.q.trim();
    items = items.filter((n) => matchIndex(q, buildSearchIndex(n.content.slice(0, 40), n.content)));
  }
  return Promise.all(
    items.slice(0, query.limit ?? 100).map(async (n) => ({
      ...n,
      tagList: parseTags(n.tags),
      attachmentCount: await countAttachments('note', n.id),
    })),
  );
}

/** 标签聚合：便签墙底部标签过滤器数据源 */
export async function listNoteTags(projectId?: string | null): Promise<{ tag: string; count: number }[]> {
  const where: Prisma.NoteWhereInput = { isArchived: false };
  if (projectId !== undefined) where.projectId = projectId;
  const notes = await prisma.note.findMany({ where, select: { tags: true } });
  const counter = new Map<string, number>();
  for (const n of notes) {
    for (const t of parseTags(n.tags)) {
      counter.set(t, (counter.get(t) ?? 0) + 1);
    }
  }
  return [...counter.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export async function deleteNote(noteId: string): Promise<void> {
  await getNote(noteId);
  await prisma.note.delete({ where: { id: noteId } });
  await deleteEntityEmbedding('note', noteId);
}
