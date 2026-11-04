'use client';

import { Pin } from 'lucide-react';
import type { Note } from '@/lib/api-types';
import { noteSummary } from '@/lib/note-summary';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

interface NoteListItemProps {
  note: Note;
  selected: boolean;
  onSelect: (noteId: string) => void;
}

/** 随手记索引行（R93）：标题 + 两行预览 + 时间/标签，一屏能扫更多条 */
export function NoteListItem({ note, selected, onSelect }: NoteListItemProps) {
  const pinned = note.pinned_at !== null;
  const { title, preview } = noteSummary(note.content);

  return (
    <button
      type="button"
      className={cn(
        'flex w-full flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors',
        selected
          ? 'border-[var(--border-strong)] bg-[var(--bg-elevated)]'
          : 'border-transparent hover:bg-[var(--bg-elevated)]',
      )}
      onClick={() => onSelect(note.id)}
      aria-current={selected ? 'true' : undefined}
      data-testid="note-list-item"
      data-pinned={pinned ? '1' : '0'}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {pinned && <Pin size={11} className="shrink-0 text-[var(--gold)]" />}
        <span
          className={cn(
            't-title-4 truncate',
            selected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
          )}
        >
          {title}
        </span>
        <span className="t-caption-5 ml-auto shrink-0 text-[var(--text-tertiary)]">
          {relativeTime(note.updated_at)}
        </span>
      </span>
      {preview && (
        <span className="t-caption-5 line-clamp-2 text-[var(--text-tertiary)]">{preview}</span>
      )}
      {note.tags.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {note.tags.map((tag) => (
            <span
              key={tag}
              className="t-caption-5 rounded-full bg-[var(--bg-card)] px-1.5 text-[var(--text-tertiary)]"
            >
              #{tag}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
