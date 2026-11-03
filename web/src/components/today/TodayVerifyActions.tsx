'use client';

import { Check, Loader2, Play, RotateCcw } from 'lucide-react';
import type { TodayItem } from '@/lib/today-types';

const base = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors disabled:opacity-50';

/** 今日「待验收」一步操作：已解决/待验证先接手，验证中可直接通过或打回。 */
export function TodayVerifyActions({
  item,
  busy,
  canEdit,
  onStart,
  onApprove,
  onReject,
}: {
  item: TodayItem;
  busy: boolean;
  canEdit: boolean;
  onStart: (item: TodayItem) => void;
  onApprove: (item: TodayItem) => void;
  onReject: (item: TodayItem) => void;
}) {
  if (!canEdit) return null;
  if (item.status === 'resolved' || item.status === 'review') {
    return (
      <button className={`${base} border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]`} disabled={busy} onClick={() => onStart(item)}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
        开始验证
      </button>
    );
  }
  if (item.status === 'verifying') {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={`${base} bg-[var(--accent-color)] text-[var(--accent-contrast)] hover:brightness-110`} disabled={busy} onClick={() => onApprove(item)}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          验收通过
        </button>
        <button className={`${base} border border-[var(--danger)]/40 text-[var(--danger)] hover:bg-[var(--danger)]/10`} disabled={busy} onClick={() => onReject(item)}>
          <RotateCcw size={12} /> 打回
        </button>
      </div>
    );
  }
  return null;
}
