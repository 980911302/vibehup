'use client';

import { useRef, useState } from 'react';
import type { Task } from '@/lib/api-types';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { TASK_STATUSES, TASK_STATUS_LABELS, TASK_TRANSITIONS, canDropTo, needsReopenReason, type TaskStatus } from '@/lib/task-flow';
import { TaskCard } from './TaskCard';

const DOT_COLOR: Record<TaskStatus, string> = {
  todo: 'var(--sev-normal)',
  doing: 'var(--sev-high)',
  review: 'var(--gold)',
  verifying: 'var(--brand)',
  done: 'var(--ok)',
  cancelled: 'var(--text-tertiary)',
};

interface TaskBoardProps {
  tasks: Task[];
  canEdit: boolean;
  onOpen: (taskId: string) => void;
  onMove: (task: Task, to: TaskStatus) => void;
  hideTerminal?: boolean;
}

function rejectReason(from: TaskStatus, to: TaskStatus): string {
  if (needsReopenReason(from, to)) return '打回需要写明原因：请点开任务，用「打回进行中」操作';
  const allowed = TASK_TRANSITIONS[from].map((s) => TASK_STATUS_LABELS[s]).join(' / ');
  return `「${TASK_STATUS_LABELS[from]}」不能直接到「${TASK_STATUS_LABELS[to]}」，只能改为：${allowed}`;
}

/** 任务看板：克制的灰底状态列 + 状态圆点，拖拽遵循状态机流转协议 */
export function TaskBoard({ tasks, canEdit, onOpen, onMove, hideTerminal = false }: TaskBoardProps) {
  const toast = useToast();
  const draggingRef = useRef<Task | null>(null);
  const [dragging, setDragging] = useState<Task | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);

  const endDrag = () => {
    draggingRef.current = null;
    setDragging(null);
    setOverCol(null);
  };

  const drop = (to: TaskStatus) => {
    const task = draggingRef.current;
    endDrag();
    if (!task || task.status === to) return;
    const from = task.status as TaskStatus;
    if (!canDropTo(from, to)) {
      toast.error(rejectReason(from, to));
      return;
    }
    onMove(task, to);
  };

  const statuses = hideTerminal ? TASK_STATUSES.filter((s) => s !== 'done' && s !== 'cancelled') : TASK_STATUSES;

  return (
    <div className="flex h-full gap-3 overflow-x-auto pb-1" data-testid="task-board">
      {statuses.map((status) => {
        const list = tasks.filter((t) => t.status === status);
        const droppable = dragging ? canDropTo(dragging.status as TaskStatus, status) : false;
        return (
          <div
            key={status}
            data-testid={`task-column-${status}`}
            className={cn(
              'vh-col min-w-[140px]',
              dragging && !droppable && dragging.status !== status && 'opacity-45',
              overCol === status && droppable && 'border-[var(--brand)] bg-[var(--brand-soft)]/35',
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(status);
            }}
            onDragLeave={() => setOverCol((prev) => (prev === status ? null : prev))}
            onDrop={() => drop(status)}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)]/70 px-3 py-2.5">
              <span className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                <i className="inline-block h-2 w-2 rounded-full" style={{ background: DOT_COLOR[status] }} />
                {TASK_STATUS_LABELS[status]}
              </span>
              <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-tertiary)]">
                {list.length}
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {list.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  draggable={canEdit}
                  dragging={dragging?.id === t.id}
                  onOpen={() => onOpen(t.id)}
                  onDragStart={() => {
                    draggingRef.current = t;
                    setDragging(t);
                  }}
                  onDragEnd={endDrag}
                />
              ))}
              {list.length === 0 && (
                <p className="py-8 text-center text-[11px] text-[var(--text-tertiary)]/70">暂无任务</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
