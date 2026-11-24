'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Archive, LayoutGrid, List, Plus, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { formatTime, type Task } from '@/lib/api-types';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/lib/task-flow';
import { HandlingLine } from '@/components/activity/HandlingLine';
import { cn } from '@/lib/utils';
import { PRIORITY_COLOR, PRIORITY_LABEL } from './TaskCard';

export function TaskUrlSync({ onOpen }: { onOpen: (taskId: string) => void }) {
  const params = useSearchParams();
  const taskId = params.get('task');
  useEffect(() => {
    if (taskId) onOpen(taskId);
  }, [taskId, onOpen]);
  return null;
}

export function TaskHeaderActions({
  viewMode,
  showArchived,
  archivedCount,
  canEdit,
  onViewChange,
  onToggleArchived,
  onCreate,
}: {
  viewMode: 'board' | 'list';
  showArchived: boolean;
  archivedCount: number;
  canEdit: boolean;
  onViewChange: (v: 'board' | 'list') => void;
  onToggleArchived: () => void;
  onCreate: () => void;
}) {
  return (
    <>
      <div className="vh-segmented hidden sm:inline-flex" role="group" aria-label="视图切换">
        <button
          type="button"
          className={cn('flex items-center gap-1 !h-7 !px-2.5 !text-xs', viewMode === 'board' && 'active')}
          onClick={() => onViewChange('board')}
          data-testid="task-view-board"
        >
          <LayoutGrid size={12} /> 看板
        </button>
        <button
          type="button"
          className={cn('flex items-center gap-1 !h-7 !px-2.5 !text-xs', viewMode === 'list' && 'active')}
          onClick={() => onViewChange('list')}
          data-testid="task-view-list"
        >
          <List size={12} /> 列表
        </button>
      </div>
      <button
        type="button"
        className={cn('vh-btn ghost h-8 px-2.5 text-xs', showArchived && 'border-[var(--brand)] text-[var(--text-primary)]')}
        onClick={onToggleArchived}
        title="切换是否显示已完成与已取消的任务"
        data-testid="task-toggle-archived"
      >
        <Archive size={13} />
        <span className="hidden md:inline">已结项</span>
        {archivedCount > 0 && <span className="opacity-70">{archivedCount}</span>}
      </button>
      {canEdit && (
        <button type="button" className="vh-btn h-8 px-2.5 text-xs" onClick={onCreate} data-testid="create-task-open">
          <Plus size={14} /> 新建任务
        </button>
      )}
    </>
  );
}

export function NewTaskInput({ projectId, onCreated }: { projectId: string; onCreated: () => Promise<void> }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await api.createTask({ project_id: projectId, title: title.trim() });
      setTitle('');
      await onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '新建任务失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="hidden items-center gap-1.5 sm:flex">
      <input
        className="vh-input-compact w-52"
        placeholder="快速添加任务，Enter 创建"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        data-testid="task-new-input"
      />
      <span className="vh-kbd">Enter</span>
    </div>
  );
}

/** 任务紧凑列表视图（Linear 风格行列表） */
export function TaskListView({
  tasks,
  hideTerminal,
  onOpen,
}: {
  tasks: Task[];
  hideTerminal: boolean;
  onOpen: (taskId: string) => void;
}) {
  const rows = hideTerminal ? tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled') : tasks;

  if (rows.length === 0) {
    return (
      <div className="vh-list-surface px-4 py-14 text-center">
        <p className="text-sm font-medium text-[var(--text-secondary)]">当前筛选条件下没有任务</p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">点击右上角「新建任务」或在工具栏快速输入添加</p>
      </div>
    );
  }

  return (
    <div className="vh-list-surface" data-testid="task-list-view">
      <div className="hidden grid-cols-[90px_1fr_140px_90px_84px] items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]/60 px-4 py-2 text-[11px] font-medium text-[var(--text-tertiary)] md:grid">
        <span>状态</span>
        <span>任务标题与标签</span>
        <span>当前经手</span>
        <span>负责人</span>
        <span className="text-right">更新时间</span>
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {rows.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`task-card-${t.id}`}
            onClick={() => onOpen(t.id)}
            className="grid w-full cursor-pointer grid-cols-1 items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-[var(--bg-elevated)] md:grid-cols-[90px_1fr_140px_90px_84px] md:gap-3"
          >
            <div className="flex items-center gap-2">
              <i className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: PRIORITY_COLOR[t.priority] }} title={`优先级：${PRIORITY_LABEL[t.priority]}`} />
              <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                {TASK_STATUS_LABELS[t.status as TaskStatus] ?? t.status}
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">{t.title}</span>
              {t.labels.slice(0, 2).map((l) => (
                <span key={l} className="hidden shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)] sm:inline">#{l}</span>
              ))}
              {t.reopened_count > 0 && (
                <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-[var(--warn)]">
                  <RotateCcw size={11} />{t.reopened_count}
                </span>
              )}
            </div>
            <div className="min-w-0 truncate"><HandlingLine item={t} /></div>
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              {t.assignee ? (
                <>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[11px] font-semibold text-[var(--brand)]">{t.assignee.name.slice(0, 1)}</span>
                  <span className="truncate text-xs">{t.assignee.name}</span>
                </>
              ) : (
                <span className="text-xs text-[var(--text-tertiary)]">未指派</span>
              )}
            </div>
            <div className="text-right text-[11px] text-[var(--text-tertiary)]">{formatTime(t.updated_at).slice(5, 16)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
