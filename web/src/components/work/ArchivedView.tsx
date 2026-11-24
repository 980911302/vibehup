'use client';

import { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRight, CheckCircle2, ListChecks } from 'lucide-react';
import { api } from '@/lib/api';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useWorkOverlay } from '@/components/work/WorkItemOverlay';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { BUG_STATUS_LABELS, formatTime, type Bug, type Task } from '@/lib/api-types';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/lib/task-flow';

/** 已归档列表（保留兼容入口，点击条目原地弹详情） */
export function ArchivedView() {
  const store = useVibeHub();
  const overlay = useWorkOverlay();
  const [tasks, setTasks] = useState<Task[]>([]);
  const projectId = store.currentProject?.id;

  useEffect(() => {
    if (!projectId) {
      setTasks([]);
      return;
    }
    let cancelled = false;
    void api
      .listTasks(projectId)
      .then((list) => {
        if (!cancelled) setTasks(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, store.taskRevision]);

  const bugs = useMemo(
    () => [...store.board.verified, ...store.board.closed].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [store.board],
  );
  const archivedTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status === 'done' || t.status === 'cancelled')
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [tasks],
  );

  if (!store.currentProject) {
    return (
      <div className="flex h-full flex-col">
        <WorkspaceHeader title="已归档" />
        <div className="vh-empty flex-1">
          <span className="vh-empty-icon"><Archive size={24} /></span>
          <p className="vh-empty-title">还没有项目</p>
          <p className="vh-empty-hint">先建一个项目，已结项的缺陷和任务会收进这里。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader title="已归档" badge={bugs.length + archivedTasks.length} />
      <div className="vh-ws-scroll">
        <div className="vh-ws-container grid gap-4 lg:grid-cols-2">
          <section className="vh-list-surface">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 px-4 py-2.5">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                <CheckCircle2 size={14} className="text-[var(--ok)]" /> 缺陷（已验证 / 已关闭）
              </h2>
              <span className="text-xs text-[var(--text-tertiary)]">{bugs.length}</span>
            </div>
            {bugs.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-[var(--text-tertiary)]">暂无已归档缺陷</p>
            ) : (
              <div>
                {bugs.map((bug: Bug) => (
                  <button
                    key={bug.id}
                    type="button"
                    className="vh-list-row"
                    onClick={() => overlay.openItem('bug', bug.id)}
                    data-testid="archived-bug-row"
                  >
                    <span className="shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)]">
                      {BUG_STATUS_LABELS[bug.status]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">{bug.title}</span>
                    <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">{formatTime(bug.updated_at).slice(5, 16)}</span>
                    <ArrowRight size={13} className="shrink-0 text-[var(--text-tertiary)]" />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="vh-list-surface">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 px-4 py-2.5">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                <ListChecks size={14} className="text-[var(--ok)]" /> 任务（已完成 / 已取消）
              </h2>
              <span className="text-xs text-[var(--text-tertiary)]">{archivedTasks.length}</span>
            </div>
            {archivedTasks.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-[var(--text-tertiary)]">暂无已归档任务</p>
            ) : (
              <div>
                {archivedTasks.map((task: Task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="vh-list-row"
                    onClick={() => overlay.openItem('task', task.id)}
                    data-testid="archived-task-row"
                  >
                    <span className="shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)]">
                      {TASK_STATUS_LABELS[task.status as TaskStatus] ?? task.status}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">{task.title}</span>
                    <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">{formatTime(task.updated_at).slice(5, 16)}</span>
                    <ArrowRight size={13} className="shrink-0 text-[var(--text-tertiary)]" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
