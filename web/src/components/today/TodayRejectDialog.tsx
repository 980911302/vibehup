'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { TodayItem } from '@/lib/today-types';

/** 今日页打回：必须写原因，避免把「为什么不行」丢在聊天里。 */
export function TodayRejectDialog({
  item,
  busy,
  onClose,
  onConfirm,
}: {
  item: TodayItem | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (item) setReason('');
  }, [item]);

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-panel)] p-5 shadow-[var(--shadow-3)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--danger)]" />
          <div>
            <h3 className="t-title-3">打回：{item.title}</h3>
            <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">
              写清楚哪里不行、下一步怎么改；原因会留在活动流里。
            </p>
          </div>
        </div>
        <textarea
          autoFocus
          className="mt-4 min-h-24 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] p-3 text-sm outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent-color)]"
          placeholder="例如：登录页 390px 下仍然溢出，先修响应式再提交"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button className="vh-btn ghost" disabled={busy} onClick={onClose}>取消</button>
          <button className="vh-btn" disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim())}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            确认打回
          </button>
        </div>
      </div>
    </div>
  );
}
