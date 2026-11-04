'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Paperclip, Pencil, Pin, StickyNote, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCanEdit } from '@/lib/auth';
import { useHotkeys } from '@/lib/shortcuts';
import type { Note } from '@/lib/api-types';
import { relativeTime } from '@/lib/time';

interface NoteDetailProps {
  note: Note;
  onTogglePin: (noteId: string, pinned: boolean) => Promise<void>;
  onUpdate: (noteId: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (noteId: string) => Promise<void>;
  onTagClick: (tag: string) => void;
  onBack: () => void;
}

/** 随手记详情（R93）：完整 Markdown + 行内编辑；桌面常驻右栏，移动端从列表进入 */
export function NoteDetail({
  note,
  onTogglePin,
  onUpdate,
  onDelete,
  onTagClick,
  onBack,
}: NoteDetailProps) {
  const canEdit = useCanEdit();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const pinned = note.pinned_at !== null;

  useEffect(() => {
    setEditing(false);
    setDraft(note.content);
  }, [note.id]);

  // 服务端内容变化（如别处编辑）时同步草稿；正在编辑时不覆盖用户输入
  useEffect(() => {
    if (!editing) setDraft(note.content);
  }, [note.content, editing]);

  const save = async () => {
    const content = draft.trim();
    if (!content) return;
    await onUpdate(note.id, { content });
    setEditing(false);
  };

  // 只在编辑态接管 Esc/⌘↵，避免常驻详情吞掉其他浮层的 Esc
  useHotkeys(
    editing
      ? [
          {
            combo: 'mod+enter',
            description: '保存编辑',
            handler: () => void save(),
            allowInInput: true,
          },
          {
            combo: 'esc',
            description: '取消编辑',
            handler: () => {
              setDraft(note.content);
              setEditing(false);
            },
            allowInInput: true,
          },
        ]
      : [],
  );

  return (
    <article className="flex min-h-0 flex-1 flex-col" data-testid="note-detail">
      <header className="shrink-0 border-b border-[var(--border-subtle)]">
        <div className="mx-auto flex w-full max-w-[860px] items-center gap-2 px-5 py-2 sm:px-6">
          <button
            className="rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] min-[900px]:hidden"
            onClick={onBack}
            title="返回列表"
            data-testid="note-back"
          >
            <ArrowLeft size={15} />
          </button>
          {pinned && (
            <span className="t-caption-5 flex items-center gap-1 text-[var(--gold)]">
              <Pin size={11} />
              置顶
            </span>
          )}
          <span className="t-caption-5 text-[var(--text-tertiary)]" title={new Date(note.created_at).toLocaleString()}>
            {relativeTime(note.updated_at)}
          </span>
          {note.updated_at !== note.created_at && (
            <span className="t-caption-5 text-[var(--text-tertiary)]">已编辑</span>
          )}
          {note.attachment_count > 0 && (
            <span className="t-caption-5 flex items-center gap-0.5 text-[var(--text-tertiary)]">
              <Paperclip size={11} />
              {note.attachment_count}
            </span>
          )}
          <div className="flex-1" />
          {canEdit && !editing && (
            <div className="flex items-center gap-0.5">
              <button
                className="rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--gold)]"
                onClick={() => void onTogglePin(note.id, !pinned)}
                title={pinned ? '取消置顶' : '置顶'}
                data-testid="note-pin"
              >
                <Pin size={14} />
              </button>
              <button
                className="rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                onClick={() => setEditing(true)}
                title="编辑"
                data-testid="note-edit"
              >
                <Pencil size={14} />
              </button>
              <button
                className="rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--danger)]"
                onClick={() => void onDelete(note.id)}
                title="删除"
                data-testid="note-delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-3 px-5 py-4 sm:px-6">
          {editing ? (
            <div>
              <textarea
                className="min-h-[280px] w-full resize-y rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] p-3 text-sm leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
                rows={14}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                data-testid="note-edit-area"
              />
              <div className="mt-2 flex justify-end gap-1.5">
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
            <div className="vh-note-prose vh-note-detail">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content}</ReactMarkdown>
            </div>
          )}

          {note.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {note.tags.map((tag) => (
                <button
                  key={tag}
                  className="t-caption-5 rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--gold)]"
                  onClick={() => onTagClick(tag)}
                  data-testid="note-tag-chip"
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function NoteDetailEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[var(--text-tertiary)]">
      <StickyNote size={28} strokeWidth={1.6} />
      <p className="t-body-5">选择一条随手记查看全文</p>
      <p className="t-caption-5">列表按置顶和时间排序，点标题即可切换</p>
    </div>
  );
}
