'use client';

import { AlertCircle, Check, RotateCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UploadItem } from '@/hooks/use-file-upload';

/**
 * 上传进度条（卡片 37）：逐文件金色 2px 进度（只动 transform: scaleX）；
 * 失败红框 + 单独重试；成功打勾后自动消失。
 */
export function UploadProgressStrip({
  items,
  onRetry,
  onDismiss,
}: {
  items: UploadItem[];
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1.5" data-testid="upload-progress-strip">
      {items.map((it) => (
        <div
          key={it.id}
          className={cn(
            'relative flex items-center gap-2 overflow-hidden rounded-[10px] px-2.5 py-1.5',
            it.status === 'error'
              ? 'border border-[var(--danger)]/60 bg-[var(--danger)]/8'
              : 'border border-[var(--border-subtle)] bg-[var(--bg-card)]',
          )}
          data-testid="upload-item"
          data-status={it.status}
        >
          {it.status === 'error' ? (
            <AlertCircle size={13} className="shrink-0 text-[var(--danger)]" />
          ) : it.status === 'done' ? (
            <Check size={13} className="shrink-0 text-[var(--ok)]" />
          ) : (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--gold)]" />
          )}
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-secondary)]" title={it.name}>
            {it.name}
          </span>
          {it.status === 'error' ? (
            <>
              <span className="shrink-0 text-[10px] text-[var(--danger)]" title={it.error}>
                {it.error ?? '失败'}
              </span>
              <button
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--gold)] transition-colors hover:bg-[var(--gold-bg)]"
                onClick={() => onRetry(it.id)}
                data-testid="upload-retry"
              >
                <RotateCw size={10} />
                重试
              </button>
            </>
          ) : (
            <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-tertiary)]">
              {it.status === 'done' ? '完成' : `${it.percent}%`}
            </span>
          )}
          <button
            className="shrink-0 rounded p-0.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
            onClick={() => onDismiss(it.id)}
            title="移除"
          >
            <X size={11} />
          </button>
          {/* 进度条：绝对定位底部，scaleX 只动 transform */}
          {it.status === 'uploading' && (
            <span
              className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-[var(--gold)] transition-transform duration-200"
              style={{ transform: `scaleX(${it.percent / 100})` }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
