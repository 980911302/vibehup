'use client';

import { useMemo, useState } from 'react';
import { Plus, StickyNote } from 'lucide-react';
import type { Note } from '@/lib/api-types';
import { NoteCard } from './NoteCard';
import { NoteComposer } from './NoteComposer';
import { CurrentProjectSwitcher } from '@/components/layout/CurrentProjectSwitcher';
import { useCanEdit } from '@/lib/auth';

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

/** 随手记瀑布流（设计文档 §5）：便签卡片 + 实时 Markdown + 底部标签过滤 */
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
  const filtered = useMemo(
    () => (activeTag ? notes.filter((n) => n.tags.includes(activeTag)) : notes),
    [notes, activeTag],
  );
  const onTagClick = (tag: string) => setActiveTag(tag);

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏：项目 + 计数 + 新建 */}
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
        <CurrentProjectSwitcher />
        <span className="text-xs text-[var(--text-tertiary)]">{filtered.length} 条随手记</span>
        <div className="flex-1" />
        {canEdit && (
          <button className="vh-btn ghost" onClick={onOpenComposer} data-testid="note-new">
            <Plus size={14} />
            记一笔
          </button>
        )}
      </div>

      {/* 录入器 */}
      {composerOpen && canEdit && (
        <div className="px-4 pt-3">
          <NoteComposer open onClose={onCloseComposer} onCreate={onCreateNote} />
        </div>
      )}

      {/* 瀑布流 */}
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <div className="vh-empty" style={{ height: '100%' }}>
            <span className="vh-empty-icon"><StickyNote size={28} strokeWidth={1.6} /></span>
            <p className="vh-empty-title">还没有随手记</p>
            <p className="vh-empty-hint">按 N 或点「记一笔」记录灵感；IDE 里的 AI 也会通过 MCP 往这里写</p>
          </div>
        ) : (
          <div className="columns-1 gap-3.5 md:columns-2 2xl:columns-3">
            {filtered.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                onTogglePin={onTogglePin}
                onUpdate={onUpdateNote}
                onDelete={onDeleteNote}
                onTagClick={onTagClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部标签过滤栏（设计文档 §5） */}
      {noteTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)] px-4 py-2" data-testid="note-tag-bar">
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
    </div>
  );
}

/** 底部标签栏药丸：选中金色，其余中性（token 化） */
function chipClass(active: boolean): string {
  const base = 'rounded-full border px-2.5 py-1 text-[11px] transition-colors cursor-pointer';
  return active
    ? `${base} border-[var(--gold)] bg-[var(--gold-bg)] text-[var(--gold)]`
    : `${base} border-[var(--border-strong)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]`;
}
