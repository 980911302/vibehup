'use client';

import { useEffect, useRef, useState } from 'react';
import { useHotkeys } from '@/lib/shortcuts';

interface NoteComposerProps {
  open: boolean;
  onClose: () => void;
  onCreate: (content: string, tags: string[]) => Promise<void>;
}

/** 随手记录入器（卡片 27）：Markdown 草稿 + 标签（空格/逗号分隔）+ ⌘↵ 发送 + Esc 关闭 */
export function NoteComposer({ open, onClose, onCreate }: NoteComposerProps) {
  const [draft, setDraft] = useState('');
  const [tagText, setTagText] = useState('');
  const [sending, setSending] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) areaRef.current?.focus();
    else {
      setDraft('');
      setTagText('');
    }
  }, [open]);

  const submit = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const tags = tagText
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20);
      await onCreate(content, tags);
    } finally {
      setSending(false);
    }
  };

  useHotkeys([
    { combo: 'mod+enter', description: '发送随手记', handler: () => void submit(), allowInInput: true },
    { combo: 'esc', description: '关闭录入器', handler: onClose, allowInInput: true },
  ]);

  if (!open) return null;

  return (
    <div className="rounded-[14px] border border-[var(--gold)] bg-[var(--bg-card)] p-3" data-testid="note-composer">
      <textarea
        ref={areaRef}
        className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        rows={4}
        placeholder="写点什么…支持 Markdown，⌘↵ 发送"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        data-testid="note-composer-area"
      />
      <div className="mt-2 flex items-center gap-2">
        <input
          className="h-7 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2 text-[11px] outline-none focus:border-[var(--brand)]"
          placeholder="标签（空格分隔，如 tech-debt）"
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          data-testid="note-composer-tags"
        />
        <span className="vh-kbd">⌘↵</span>
        <button className="vh-btn ghost" onClick={onClose}>
          取消
        </button>
        <button
          className="vh-btn"
          style={{ background: 'var(--gold-bg)', color: 'var(--gold)', border: '1px solid var(--gold)' }}
          onClick={() => void submit()}
          disabled={sending || !draft.trim()}
          data-testid="note-composer-send"
        >
          记录
        </button>
      </div>
    </div>
  );
}
