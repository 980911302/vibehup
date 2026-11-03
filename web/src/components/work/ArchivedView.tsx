'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArrowRight, CheckCircle2, ListChecks } from 'lucide-react';
import { api } from '@/lib/api';
import { useVibeHub } from '@/hooks/use-vibehub';
import { BUG_STATUS_LABELS, formatTime, type Bug, type Task } from '@/lib/api-types';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/lib/task-flow';

/**
 * 工作 · 已归档（R89 迭代）：已完成的缺陷 / 任务默认收在这里，
 * 不再占用看板列；点开仍可查看历史、重开或删除。
 */
export function ArchivedView() {
  const store = useVibeHub();
  const router = useRouter();
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
    () => tasks.filter((t) => t.status === 'done' || t.status === 'cancelled').sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [tasks],
  );

  if (!store.currentProject) {
    return (
      <div className="vh-empty" style={{ height: '100%' }}>
        <span className="vh-empty-icon"><Archive size={24} /></span>
        <p className="vh-empty-title">还没有项目</p>
        <p className="vh-empty-hint">先建一个项目，完成的缺陷和任务会自动收进这里。</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] p-4 sm:p-6">
      <header className="mb-5">
        <p className="t-caption-4 flex items-center gap-2 text-[var(--text-tertiary)]">
          <Archive size={14} /> 工作 · 已归档
        </p>
        <h1 className="t-heading-4 mt-2">做完的，收在这里</h1>
        <p className="t-body-3 mt-2 max-w-[680px] text-[var(--text-secondary)]">
          已完成 / 已关闭的缺陷与已完成 / 已取消的任务默认不占用工作看板；点开可以看历史、重开或删除。
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="vh-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-5 py-3">
            <div>
              <h2 className="t-title-3 flex items-center gap-2"><CheckCircle2 size={16} className="text-[var(--ok)]" /> 缺陷</h2>
              <p className="t-caption-5 mt-0.5 text-[var(--text-tertiary)]">已验证 / 已关闭</p>
            </div>
            <span className="t-caption-1 text-[var(--text-tertiary)]">{bugs.length} 条</span>
          </div>
          {bugs.length === 0 ? (
            <p className="t-caption-2 px-5 py-8 text-center text-[var(--text-tertiary)]">还没有归档的缺陷</p>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {bugs.map((bug: Bug) => (
                <button
                  key={bug.id}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--bg-elevated)]"
                  onClick={() => router.push(`/work/bugs?bug=${bug.id}`)}
                  data-testid="archived-bug-row"
                >
                  <span className="shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs text-[var(--text-tertiary)]">
                    {BUG_STATUS_LABELS[bug.status]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="t-caption-1 block truncate text-[var(--text-primary)]">{bug.title}</span>
                    <span className="t-caption-5 block truncate text-[var(--text-tertiary)]">{formatTime(bug.updated_at)}</span>
                  </span>
                  <ArrowRight size={13} className="shrink-0 text-[var(--text-tertiary)]" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="vh-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-5 py-3">
            <div>
              <h2 className="t-title-3 flex items-center gap-2"><ListChecks size={16} className="text-[var(--ok)]" /> 任务</h2>
              <p className="t-caption-5 mt-0.5 text-[var(--text-tertiary)]">已完成 / 已取消</p>
            </div>
            <span className="t-caption-1 text-[var(--text-tertiary)]">{archivedTasks.length} 条</span>
          </div>
          {archivedTasks.length === 0 ? (
            <p className="t-caption-2 px-5 py-8 text-center text-[var(--text-tertiary)]">还没有归档的任务</p>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {archivedTasks.map((task: Task) => (
                <button
                  key={task.id}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--bg-elevated)]"
                  onClick={() => router.push(`/work/tasks?task=${task.id}`)}
                  data-testid="archived-task-row"
                >
                  <span className="shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs text-[var(--text-tertiary)]">
                    {TASK_STATUS_LABELS[task.status as TaskStatus] ?? task.status}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="t-caption-1 block truncate text-[var(--text-primary)]">{task.title}</span>
                    <span className="t-caption-5 block truncate text-[var(--text-tertiary)]">{formatTime(task.updated_at)}</span>
                  </span>
                  <ArrowRight size={13} className="shrink-0 text-[var(--text-tertiary)]" />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
