'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, StickyNote } from 'lucide-react';
import type { Note } from '@/lib/api-types';
import { NoteComposer } from './NoteComposer';
import { NoteDetail, NoteDetailEmpty } from './NoteDetail';
import { NoteListItem } from './NoteListItem';
import { useCanEdit } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface NoteWallProps {
  notes: Note[];
  noteTags: { tag: string; count: number }[];
  composerOpen: boolean;
  onOpenComposer: () => void;
  onCloseComposer: () => void;
  onCreateNote: (content: string, tags: string[]) => Promise<void>;
  onTogglePin: (noteId: string, pinned: boolean) => Promise<void>;
  onUpdateNote: (noteId: string, patch: Record<string, unknown>) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
}

/**
 * 随手记工作区（R93 信息密度改版）：
 * 桌面 = 左侧索引（标题 + 两行预览，一屏多条）+ 右侧全文阅读/编辑；
 * 窄屏 = 先看索引，点一条进入全文，返回键回列表。
 * 数据与写操作仍走 use-vibehub 中枢，不新增接口。
 */
export function NoteWall({
  notes,
  noteTags,
  composerOpen,
  onOpenComposer,
  onCloseComposer,
  onCreateNote,
  onTogglePin,
  onUpdateNote,
  onDeleteNote,
}: NoteWallProps) {
  const canEdit = useCanEdit();
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [pendingCreate, setPendingCreate] = useState<string | null>(null);

  const filtered = useMemo(
    () => (activeTag ? notes.filter((n) => n.tags.includes(activeTag)) : notes),
    [notes, activeTag],
  );
  const selected = filtered.find((n) => n.id === selectedId) ?? null;

  // 当前选中项被筛掉/删除时自动落到第一条，避免右栏空白
  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      setMobileDetail(false);
      return;
    }
    if (!filtered.some((n) => n.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const selectNote = (noteId: string) => {
    setSelectedId(noteId);
    setMobileDetail(true);
  };

  const filterByTag = (tag: string) => {
    setActiveTag(tag);
    setMobileDetail(false);
  };

  const deleteNote = async (noteId: string) => {
    await onDeleteNote(noteId);
    if (mobileDetail) setMobileDetail(false);
  };

  // 新建后等列表刷新，按内容认出新卡片并选中，右栏不停在上一条
  useEffect(() => {
    if (!pendingCreate) return;
    const created = notes.find((n) => n.content === pendingCreate);
    if (created) {
      setSelectedId(created.id);
      setPendingCreate(null);
    }
  }, [notes, pendingCreate]);

  const createNote = async (content: string, tags: string[]) => {
    // 清掉标签筛选，保证刚写的笔记一定出现在索引里
    setActiveTag(null);
    setPendingCreate(content);
    try {
      await onCreateNote(content, tags);
    } catch (error) {
      setPendingCreate(null);
      throw error;
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <aside
        className={cn(
          'flex min-h-0 w-full flex-col border-[var(--border-subtle)] min-[900px]:w-[340px] min-[900px]:shrink-0 min-[900px]:border-r',
          mobileDetail && 'hidden min-[900px]:flex',
        )}
        aria-label="随手记索引"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
          <span className="t-caption-4 text-[var(--text-secondary)]">{filtered.length} 条随手记</span>
          {activeTag && (
            <button
              className="t-caption-5 rounded-full bg-[var(--gold-bg)] px-1.5 text-[var(--gold)]"
              onClick={() => setActiveTag(null)}
              title="清除标签筛选"
            >
              #{activeTag} ×
            </button>
          )}
          <div className="flex-1" />
          {canEdit && (
            <button className="vh-btn ghost" onClick={onOpenComposer} data-testid="note-new">
              <Plus size={14} />
              记一笔
            </button>
          )}
        </div>

        {composerOpen && canEdit && (
          <div className="shrink-0 border-b border-[var(--border-subtle)] p-3">
            <NoteComposer open onClose={onCloseComposer} onCreate={createNote} />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="vh-empty min-h-[220px] px-4">
              <span className="vh-empty-icon">
                <StickyNote size={28} strokeWidth={1.6} />
              </span>
              <p className="vh-empty-title">{activeTag ? '这个标签下还没有随手记' : '还没有随手记'}</p>
              <p className="vh-empty-hint">
                {activeTag
                  ? '换个标签，或点「记一笔」记录一条'
                  : '按 N 或点「记一笔」记录灵感；IDE 里的 AI 也会通过 MCP 往这里写'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filtered.map((n) => (
                <NoteListItem
                  key={n.id}
                  note={n}
                  selected={n.id === selected?.id}
                  onSelect={selectNote}
                />
              ))}
            </div>
          )}
        </div>

        {noteTags.length > 0 && (
          <div
            className="flex max-h-[104px] shrink-0 flex-wrap items-center gap-1.5 overflow-y-auto border-t border-[var(--border-subtle)] px-3 py-2"
            data-testid="note-tag-bar"
          >
            <button
              className={chipClass(activeTag === null)}
              onClick={() => setActiveTag(null)}
              data-testid="note-tag-all"
            >
              全部
            </button>
            {noteTags.map(({ tag, count }) => (
              <button
                key={tag}
                className={chipClass(activeTag === tag)}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                data-testid="note-tag-filter"
              >
                #{tag}
                <span className="ml-1 text-[var(--text-tertiary)]">{count}</span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <section
        className={cn('min-h-0 flex-1 flex-col', mobileDetail ? 'flex' : 'hidden min-[900px]:flex')}
        aria-label="随手记全文"
      >
        {selected ? (
          <NoteDetail
            note={selected}
            onTogglePin={onTogglePin}
            onUpdate={onUpdateNote}
            onDelete={deleteNote}
            onTagClick={filterByTag}
            onBack={() => setMobileDetail(false)}
          />
        ) : (
          <NoteDetailEmpty />
        )}
      </section>
    </div>
  );
}

/** 底部标签栏药丸：选中金色，其余中性（token 化） */
function chipClass(active: boolean): string {
  const base = 'rounded-full border px-2.5 py-1 text-xs transition-colors cursor-pointer';
  return active
    ? `${base} border-[var(--gold)] bg-[var(--gold-bg)] text-[var(--gold)]`
    : `${base} border-[var(--border-strong)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]`;
}
