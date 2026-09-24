'use client';

import { useState } from 'react';
import { Trash2, Tag, UserPlus, X } from 'lucide-react';

/** 批量操作栏（步骤 07 §7.1：Excel 式批量，滑入动画） */
export function BatchBar({
  count, canEdit, onClear, onAction,
}: {
  count: number;
  canEdit: boolean;
  onClear: () => void;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [labelInput, setLabelInput] = useState('');

  const run = async (action: string, payload?: Record<string, unknown>) => {
    setBusy(true);
    try {
      await onAction(action, payload);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-4 py-2 shadow-lg"
      style={{ animation: 'vh-toast-in 220ms var(--ease-spring) 1' }}
      data-testid="batch-bar"
    >
      <span className="text-xs font-medium text-[var(--text-primary)]">已选 {count} 项</span>

      {canEdit && (
        <>
          <select
            className="h-7 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-1.5 text-xs outline-none"
            disabled={busy}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) void run('status', { status: e.target.value });
              e.target.value = '';
            }}
          >
            <option value="" disabled>改状态</option>
            <option value="open">待处理</option>
            <option value="in_progress">进行中</option>
            <option value="resolved">已解决</option>
            <option value="verified">已验证</option>
            <option value="closed">已关闭</option>
          </select>

          <div className="flex items-center gap-1">
            <Tag size={13} className="text-[var(--text-tertiary)]" />
            <input
              className="h-7 w-24 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-1.5 text-xs outline-none"
              placeholder="加标签"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && labelInput.trim()) {
                  void run('label', { labels: [labelInput.trim()] });
                  setLabelInput('');
                }
              }}
            />
          </div>

          <button
            className="flex h-7 items-center gap-1 rounded-md border border-[var(--danger)] px-2 text-xs text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 cursor-pointer"
            disabled={busy}
            onClick={() => void run('delete')}
          >
            <Trash2 size={13} />
            删除
          </button>
        </>
      )}

      <button className="vh-icon-btn h-7 w-7" onClick={onClear} title="清除选择（Esc）">
        <X size={14} />
      </button>
    </div>
  );
}
