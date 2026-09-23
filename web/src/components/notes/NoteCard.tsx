'use client';

import { useState } from 'react';
import { Paperclip, Pencil, Pin, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useHotkeys } from '@/lib/shortcuts';
import type { Note } from '@/lib/api-types';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

interface NoteCardProps {
  note: Note;
  onTogglePin: (noteId: string, pinned: boolean) => Promise<void>;
  onUpdate: (noteId: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (noteId: string) => Promise<void>;
  onTagClick: (tag: string) => void;
}

/** 随手记卡片（卡片 27）：Markdown 渲染 + 置顶浮顶 + 行内编辑 + 标签筛选入口 */
export function NoteCard({ note, onTogglePin, onUpdate, onDelete, onTagClick }: NoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const pinned = note.pinned_at !== null;

  const save = async () => {
    const content = draft.trim();
    if (!content) return;
    await onUpdate(note.id, { content });
    setEditing(false);
  };

  useHotkeys([
    { combo: 'mod+enter', description: '保存编辑', handler: () => { if (editing) void save(); }, allowInInput: true },
    {
      combo: 'esc',
      description: '取消编辑',
      handler: () => {
        if (!editing) return;
        setDraft(note.content);
        setEditing(false);
      },
      allowInInput: true,
    },
  ]);

  return (
    <div
      className={cn(
        'vh-note-card group mb-3.5 rounded-[14px] border bg-[var(--bg-card)] p-3 shadow-sm transition-shadow hover:shadow-md',
        pinned ? 'border-[var(--gold)]' : 'border-[var(--border-subtle)]',
      )}
      data-testid="note-card"
      data-pinned={pinned ? '1' : '0'}
    >
      {/* 顶栏：置顶标记与操作（悬停显现） */}
      <div className="mb-1.5 flex items-center gap-1">
        {pinned && <span className="text-[10px] font-medium text-[var(--gold)]">置顶</span>}
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <button
            className="rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--gold)]"
            onClick={() => void onTogglePin(note.id, !pinned)}
            title={pinned ? '取消置顶' : '置顶'}
            data-testid="note-pin"
          >
            <Pin size={13} />
          </button>
          <button
            className="rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            onClick={() => setEditing(true)}
            title="编辑"
            data-testid="note-edit"
          >
            <Pencil size={13} />
          </button>
          <button
            className="rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-red-500"
            onClick={() => void onDelete(note.id)}
            title="删除"
            data-testid="note-delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* 内容：编辑态 / Markdown 渲染 */}
      {editing ? (
        <div>
          <textarea
            className="w-full resize-none rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] p-2 text-[13px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
            rows={5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            data-testid="note-edit-area"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              className="vh-btn ghost"
              onClick={() => {
                setDraft(note.content);
                setEditing(false);
              }}
            >
              取消
            </button>
            <button
              className="vh-btn"
              style={{ background: 'var(--gold-bg)', color: 'var(--gold)', border: '1px solid var(--gold)' }}
              onClick={() => void save()}
              data-testid="note-save"
            >
              保存
            </button>
          </div>
        </div>
      ) : (
        <div className="vh-note-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content}</ReactMarkdown>
        </div>
      )}

      {/* 标签（点击即筛选） */}
      {note.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {note.tags.map((t) => (
            <button
              key={t}
              className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--gold)]"
              onClick={() => onTagClick(t)}
              data-testid="note-tag-chip"
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      {/* 底栏：相对时间 + 附件数 */}
      <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
        <span title={new Date(note.created_at).toLocaleString()}>{relativeTime(note.created_at)}</span>
        {note.attachment_count > 0 && (
          <span className="flex items-center gap-0.5" title={`${note.attachment_count} 个附件`}>
            <Paperclip size={10} />
            {note.attachment_count}
          </span>
        )}
        {note.updated_at !== note.created_at && !editing && <span className="ml-auto">已编辑</span>}
      </div>
    </div>
  );
}
