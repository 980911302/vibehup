'use client';

import { useState } from 'react';
import { MessageSquarePlus, Sparkles } from 'lucide-react';
import { formatSize, formatTime, isImage, isText, type Attachment, type BugComment } from '@/lib/api-types';
import { Field } from './BugEditors';

/** 附件网格：图片直出缩略图，文本可在线查看 */
export function BugAttachments({ attachments, onOpenText }: { attachments: Attachment[]; onOpenText: (id: string, name: string) => void }) {
  return (
    <Field label={`附件（${attachments.length}）`}>
      {attachments.length === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)]">暂无附件</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {attachments.map((a) => (
            <div key={a.id} className="group relative">
              {isImage(a) ? (
                <a href={a.public_url ?? '#'} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.public_url ?? ''} alt={a.file_name} className="aspect-[4/3] w-full rounded-md border border-[var(--border-subtle)] object-cover" />
                </a>
              ) : isText(a) ? (
                <button
                  className="flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 text-center text-[10px] text-[var(--text-tertiary)] hover:border-[var(--brand)]"
                  onClick={() => onOpenText(a.id, a.file_name)}
                >
                  <span className="line-clamp-2 break-all">{a.file_name}</span>
                  <span className="text-[var(--brand)]">在线查看</span>
                </button>
              ) : (
                <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 text-center text-[10px] text-[var(--text-tertiary)]">
                  {a.file_name} · {formatSize(a.file_size)}
                </div>
              )}
              {a.uploaded_by?.startsWith('key_') && (
                <span className="vh-ai-badge absolute left-1 top-1 scale-90" title="MCP 密钥上传"><Sparkles size={9} strokeWidth={2.4} />AI</span>
              )}
            </div>
          ))}
        </div>
      )}
    </Field>
  );
}

interface ActivityProps {
  comments: BugComment[];
  canEdit: boolean;
  onComment: (content: string) => Promise<void>;
}

/** 活动流：状态变更记录与评论（人 / AI） */
export function BugActivity({ comments, canEdit, onComment }: ActivityProps) {
  const [draft, setDraft] = useState('');
  const submit = async () => {
    if (!draft.trim()) return;
    await onComment(draft.trim());
    setDraft('');
  };
  return (
    <Field label={`活动流（${comments.length}）`}>
      <div className="space-y-2">
        {comments.map((c) => (
          <div key={c.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
              {c.author_type === 'ai' ? (
                <span className="vh-ai-badge"><Sparkles size={9} strokeWidth={2.4} />AI{c.author_name ? ` · ${c.author_name}` : ''}</span>
              ) : (
                <span className="font-medium text-[var(--text-secondary)]">{c.author_name ?? '成员'}</span>
              )}
              <span>{formatTime(c.created_at)}</span>
            </div>
            <p className="whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{c.content}</p>
          </div>
        ))}
        {comments.length === 0 && <p className="text-xs text-[var(--text-tertiary)]">暂无动态</p>}
        {canEdit && (
          <div className="flex gap-2">
            <input
              className="flex h-9 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none focus:border-[var(--brand)]"
              placeholder="写下修复过程或追问…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
            <button className="vh-btn" onClick={() => void submit()} disabled={!draft.trim()} aria-label="发表评论">
              <MessageSquarePlus size={14} />
            </button>
          </div>
        )}
      </div>
    </Field>
  );
}
