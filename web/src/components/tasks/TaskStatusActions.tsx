'use client';

import { useState } from 'react';
import type { Task } from '@/lib/api-types';
import { needsReopenReason, nextStatuses, transitionLabel, TASK_STATUS_LABELS, type TaskStatus } from '@/lib/task-flow';

interface TaskStatusActionsProps {
  task: Task;
  disabled: boolean;
  /** 返回是否成功；失败时由调用方提示，表单保持打开 */
  onTransition: (to: TaskStatus, reopenReason?: string) => Promise<boolean>;
}

/** 只摆出合法的下一步；打回要在页内写原因（不再用浏览器原生 prompt） */
export function TaskStatusActions({ task, disabled, onTransition }: TaskStatusActionsProps) {
  const [reopenTo, setReopenTo] = useState<TaskStatus | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const from = task.status as TaskStatus;

  const run = async (to: TaskStatus, why?: string) => {
    setBusy(true);
    const ok = await onTransition(to, why);
    setBusy(false);
    if (!ok) return;
    setReopenTo(null);
    setReason('');
  };

  if (reopenTo) {
    return (
      <div className="flex w-full flex-wrap items-center gap-2" data-testid="task-reopen-form">
        <input
          autoFocus
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2.5 text-xs outline-none focus:border-[var(--brand)]"
          placeholder="打回原因：验收时发现了什么问题"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && reason.trim() && void run(reopenTo, reason.trim())}
        />
        <button className="vh-btn h-8 text-xs" disabled={!reason.trim() || busy} onClick={() => void run(reopenTo, reason.trim())}>
          确认打回
        </button>
        <button className="vh-btn ghost h-8 text-xs" onClick={() => setReopenTo(null)}>取消</button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="rounded-md bg-[var(--brand-soft)] px-2 py-1 text-xs text-[var(--brand)]" data-testid="task-status-chip">
        {TASK_STATUS_LABELS[from]}
      </span>
      {!disabled && nextStatuses(task).map((to) => (
        <button
          key={to}
          className={`rounded-md border px-2 py-1 text-xs transition-colors cursor-pointer disabled:opacity-40 ${
            to === 'cancelled'
              ? 'border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)]'
              : 'border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
          }`}
          disabled={busy}
          data-testid={`task-to-${to}`}
          onClick={() => (needsReopenReason(from, to) ? setReopenTo(to) : void run(to))}
        >
          {transitionLabel(from, to)}
        </button>
      ))}
    </div>
  );
}
