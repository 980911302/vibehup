'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { FolderPlus, ListTodo, Search } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useWorkOverlay } from '@/components/work/WorkItemOverlay';
import { useCanEdit } from '@/lib/auth';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { Task } from '@/lib/api-types';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/lib/task-flow';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { TaskBoard } from '@/components/tasks/TaskBoard';
import { NewTaskInput, TaskHeaderActions, TaskListView, TaskUrlSync } from '@/components/tasks/TaskListView';
import { TaskDetailDialog } from '@/components/tasks/TaskDetailDialog';
import { CreateTaskDialog } from '@/components/tasks/CreateTaskDialog';
import { cn } from '@/lib/utils';

/** 任务工作区：统一顶栏 + 看板/列表双视图切换 + 新建任务对话框 + 严格当前项目隔离 */
export default function TasksPage() {
  const store = useVibeHub();
  const overlay = useWorkOverlay();
  const pathname = usePathname();
  const toast = useToast();

  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [showArchived, setShowArchived] = useState(!pathname.startsWith('/work'));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [labelFilter, setLabelFilter] = useState('');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const canEdit = useCanEdit();
  const projectId = store.currentProject?.id;

  useEffect(() => setShowArchived(!pathname.startsWith('/work')), [pathname]);

  const load = useCallback(async () => {
    if (!projectId) {
      setTasks([]);
      return;
    }
    try {
      setTasks(await api.listTasks(projectId));
    } catch {
      // 忽略
    }
  }, [projectId]);

  useEffect(() => {
    setTasks([]);
    setDetailId(null);
    void load();
  }, [projectId, load]);

  useEffect(() => {
    void load();
  }, [load, store.taskRevision]);

  const closeDetail = () => {
    setDetailId(null);
    if (typeof window !== 'undefined' && window.location.search.includes('task=')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('task');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }
  };

  const allLabels = useMemo(() => [...new Set(tasks.flatMap((t) => t.labels))].sort(), [tasks]);
  const visible = useMemo(() => {
    let list = labelFilter ? tasks.filter((t) => t.labels.includes(labelFilter)) : tasks;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q));
    }
    return list;
  }, [tasks, labelFilter, search]);

  if (!store.loading && !store.currentProject) {
    return (
      <div className="flex h-full flex-col">
        <WorkspaceHeader title="任务" />
        <div className="vh-empty flex-1">
          <span className="vh-empty-icon"><ListTodo size={24} strokeWidth={1.6} /></span>
          <p className="vh-empty-title">还没有项目</p>
          <p className="vh-empty-hint">任务严格归属当前项目工作区；也可以一键转为缺陷</p>
          <button
            type="button"
            className="vh-btn h-8 text-xs"
            onClick={() => window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'))}
            data-testid="tasks-empty-create"
          >
            <FolderPlus size={14} /> 创建第一个项目
          </button>
        </div>
      </div>
    );
  }

  const move = async (task: Task, to: TaskStatus) => {
    try {
      await api.updateTask(task.id, { status: to });
      store.notifyWorkChanged();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '状态修改失败');
    }
  };

  const convertToBug = async (task: Task) => {
    try {
      const bug = await store.createBug({
        title: `[任务转缺陷] ${task.title}`,
        steps_to_reproduce: task.description ?? undefined,
        labels: task.labels,
      });
      await api.deleteTask(task.id);
      store.notifyWorkChanged();
      await load();
      toast.success('已转为缺陷', {
        action: { label: '原地查看', onClick: () => overlay.openItem('bug', bug.id) },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '转缺陷失败');
    }
  };

  const hideTerminal = !showArchived;
  const archivedCount = tasks.filter((t) => t.status === 'done' || t.status === 'cancelled').length;
  const mobileTasks = hideTerminal ? visible.filter((t) => t.status !== 'done' && t.status !== 'cancelled') : visible;

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        title="任务"
        badge={visible.length}
        actions={
          <TaskHeaderActions
            viewMode={viewMode}
            showArchived={showArchived}
            archivedCount={archivedCount}
            canEdit={canEdit}
            onViewChange={setViewMode}
            onToggleArchived={() => setShowArchived((v) => !v)}
            onCreate={() => setCreateOpen(true)}
          />
        }
      />

      <div className="vh-ws-toolbar">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input className="vh-input-compact w-44 pl-7" placeholder="搜索任务" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {allLabels.length > 0 && (
          <select className="vh-input-compact px-2" value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} data-testid="task-label-filter">
            <option value="">全部标签</option>
            {allLabels.map((l) => <option key={l} value={l}>#{l}</option>)}
          </select>
        )}
        <div className="flex-1" />
        {canEdit && store.currentProject && (
          <NewTaskInput projectId={store.currentProject.id} onCreated={async () => { store.notifyWorkChanged(); await load(); }} />
        )}
      </div>

      <div className={cn('flex-1 min-h-0', viewMode === 'board' ? 'overflow-hidden p-4' : 'overflow-y-auto p-5')}>
        {viewMode === 'list' ? (
          <div className="vh-ws-container">
            <TaskListView tasks={visible} hideTerminal={hideTerminal} onOpen={setDetailId} />
          </div>
        ) : (
          <>
            <div className="hidden h-full md:block">
              <TaskBoard tasks={visible} canEdit={canEdit} hideTerminal={hideTerminal} onOpen={setDetailId} onMove={(t, to) => void move(t, to)} />
            </div>
            <div className="h-full space-y-2 overflow-y-auto md:hidden">
              {mobileTasks.length === 0 && <p className="py-10 text-center text-xs text-[var(--text-tertiary)]">当前筛选下没有任务。</p>}
              {mobileTasks.map((t) => (
                <button key={t.id} type="button" className="vh-card w-full p-3 text-left" onClick={() => setDetailId(t.id)}>
                  <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs text-[var(--text-tertiary)]">{TASK_STATUS_LABELS[t.status as TaskStatus]}</span>
                  <p className="mt-1.5 line-clamp-2 text-sm font-medium text-[var(--text-primary)]">{t.title}</p>
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">{t.assignee?.name ?? '未指派'}</p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <Suspense fallback={null}>
        <TaskUrlSync onOpen={setDetailId} />
      </Suspense>

      {store.currentProject && (
        <CreateTaskDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          projectId={store.currentProject.id}
          projectName={store.currentProject.name}
          labelSuggestions={allLabels}
          onCreated={() => { store.notifyWorkChanged(); void load(); }}
        />
      )}

      {detailId && (
        <TaskDetailDialog
          taskId={detailId}
          canEdit={canEdit}
          labelSuggestions={allLabels}
          onClose={closeDetail}
          onChanged={() => { store.notifyWorkChanged(); void load(); }}
          onConvertToBug={convertToBug}
        />
      )}
    </div>
  );
}
