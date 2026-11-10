'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, StickyNote, X } from 'lucide-react';
import type { Note } from '@/lib/api-types';
import { NoteComposer } from './NoteComposer';
import { NoteDetail, NoteDetailEmpty } from './NoteDetail';
import { NoteListItem } from './NoteListItem';
import { useCanEdit } from '@/lib/auth';
import { noteMatchesQuery } from '@/lib/note-summary';
import { useHotkeys } from '@/lib/shortcuts';
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
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;

  const filtered = useMemo(
    () =>
      notes.filter(
        (n) =>
          (!activeTag || n.tags.includes(activeTag)) &&
          noteMatchesQuery(n.content, n.tags, query),
      ),
    [notes, activeTag, query],
  );
  const selected = filtered.find((n) => n.id === selectedId) ?? null;

  // 「/」聚焦搜索：列表长起来后不必再滚着找
  useHotkeys([
    {
      combo: '/',
      description: '搜索随手记',
      handler: () => searchRef.current?.focus(),
    },
  ]);

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
    // 清掉筛选，保证刚写的笔记一定出现在索引里
    setActiveTag(null);
    setQuery('');
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
        <div className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="flex items-center gap-2">
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
          <div className="relative mt-2">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
            />
            <input
              ref={searchRef}
              className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] pl-7 pr-7 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand)]"
              placeholder="搜索随手记（/）"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('');
                  e.currentTarget.blur();
                }
              }}
              aria-label="搜索随手记"
              data-testid="note-search"
            />
            {query && (
              <button
                type="button"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                title="清空搜索"
                aria-label="清空搜索"
                data-testid="note-search-clear"
              >
                <X size={12} />
              </button>
            )}
          </div>
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
              <p className="vh-empty-title">
                {searching ? '没有匹配的随手记' : activeTag ? '这个标签下还没有随手记' : '还没有随手记'}
              </p>
              <p className="vh-empty-hint">
                {searching
                  ? '换个关键词，或点输入框右侧的 × 清空搜索'
                  : activeTag
                    ? '换个标签，或点「记一笔」记录一条'
                    : '按 N 或点「记一笔」记录灵感；IDE 里的 AI 也会通过 MCP 往这里写'}
              </p>
              {searching && (
                <button
                  className="vh-btn ghost mt-2"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                >
                  清空搜索
                </button>
              )}
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
