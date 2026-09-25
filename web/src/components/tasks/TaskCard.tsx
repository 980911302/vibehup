'use client';

import { RotateCcw } from 'lucide-react';
import type { Task } from '@/lib/api-types';
import { cn } from '@/lib/utils';
import { HandlingLine } from '@/components/activity/HandlingLine';

export const PRIORITY_LABEL: Record<Task['priority'], string> = { low: '低', medium: '中', high: '高' };
export const PRIORITY_COLOR: Record<Task['priority'], string> = {
  low: 'var(--sev-low)',
  medium: 'var(--sev-normal)',
  high: 'var(--sev-high)',
};

const MAX_LABELS = 3;

interface TaskCardProps {
  task: Task;
  dragging: boolean;
  draggable: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

/** 任务卡片：点击打开详情；谁在处理·多久、标签、优先级、打回次数、负责人首字 */
export function TaskCard({ task, dragging, draggable, onOpen, onDragStart, onDragEnd }: TaskCardProps) {
  const extra = task.labels.length - MAX_LABELS;
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      data-testid={`task-card-${task.id}`}
      className={cn(
        'block w-full cursor-pointer rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5 text-left transition-[transform,opacity] hover:border-[var(--border-strong)]',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-2">
        <p className="line-clamp-2 flex-1 text-[13px] font-medium text-[var(--text-primary)]">{task.title}</p>
        {task.assignee && (
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[10px] text-[var(--brand)]"
            title={`负责人 ${task.assignee.name}`}
          >
            {task.assignee.name.slice(0, 1)}
          </span>
        )}
      </div>
      {task.description && (
        <p className="mt-1 line-clamp-2 text-[11px] text-[var(--text-tertiary)]">{task.description}</p>
      )}
      <HandlingLine item={task} className="mt-1.5" />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]" title="优先级">
          <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: PRIORITY_COLOR[task.priority] }} />
          {PRIORITY_LABEL[task.priority]}
        </span>
        {task.labels.slice(0, MAX_LABELS).map((l) => (
          <span key={l} className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">#{l}</span>
        ))}
        {extra > 0 && <span className="text-[10px] text-[var(--text-tertiary)]">+{extra}</span>}
        {task.reopened_count > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-[var(--warn)]" title={`被打回 ${task.reopened_count} 次`}>
            <RotateCcw size={10} />
            {task.reopened_count}
          </span>
        )}
      </div>
    </button>
  );
}
