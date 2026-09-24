'use client';

import { useRef, useState } from 'react';
import type { Task } from '@/lib/api-types';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { TASK_STATUSES, TASK_STATUS_LABELS, TASK_TRANSITIONS, canDropTo, needsReopenReason, type TaskStatus } from '@/lib/task-flow';
import { TaskCard } from './TaskCard';

const ACCENT: Record<TaskStatus, string> = {
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
}

/** 为什么不能落到这一列：人话提示下一步能去哪 */
function rejectReason(from: TaskStatus, to: TaskStatus): string {
  if (needsReopenReason(from, to)) return '打回需要写明原因：请点开任务，用「打回进行中」操作';
  const allowed = TASK_TRANSITIONS[from].map((s) => TASK_STATUS_LABELS[s]).join(' / ');
  return `「${TASK_STATUS_LABELS[from]}」不能直接到「${TASK_STATUS_LABELS[to]}」，只能改为：${allowed}`;
}

/** 任务看板（每个状态一列）：拖拽只接受合法的下一步，拖动时高亮可放的列 */
export function TaskBoard({ tasks, canEdit, onOpen, onMove }: TaskBoardProps) {
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

  return (
    <div className="flex h-full gap-3 overflow-x-auto pb-2" data-testid="task-board">
      {TASK_STATUSES.map((status) => {
        const list = tasks.filter((t) => t.status === status);
        const droppable = dragging ? canDropTo(dragging.status as TaskStatus, status) : false;
        return (
          <div
            key={status}
            data-testid={`task-column-${status}`}
            className={cn(
              'flex min-h-32 min-w-[150px] flex-1 flex-col rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] transition-[opacity,border-color]',
              dragging && !droppable && dragging.status !== status && 'opacity-50',
              overCol === status && droppable && 'border-[var(--gold)] bg-[var(--gold-bg)]',
            )}
            style={{ borderTop: `2px solid ${ACCENT[status]}` }}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(status);
            }}
            onDragLeave={() => setOverCol((prev) => (prev === status ? null : prev))}
            onDrop={() => drop(status)}
          >
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">{TASK_STATUS_LABELS[status]}</span>
              <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]">{list.length}</span>
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
              {list.length === 0 && <p className="py-6 text-center text-xs text-[var(--text-tertiary)]">暂无任务</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
