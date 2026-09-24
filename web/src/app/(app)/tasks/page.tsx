'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FolderPlus, ListTodo } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useCanEdit } from '@/lib/auth';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { Task } from '@/lib/api-types';
import type { TaskStatus } from '@/lib/task-flow';
import { CurrentProjectSwitcher } from '@/components/layout/CurrentProjectSwitcher';
import { TaskBoard } from '@/components/tasks/TaskBoard';
import { TaskDetailDialog } from '@/components/tasks/TaskDetailDialog';

/**
 * 地址栏 ?task=<id> 打开任务详情（命令面板搜索结果跳转用）。
 * 用 useSearchParams 而不是只在挂载时读一次：已在任务页时再从 ⌘K 跳转，页面不会重新挂载。
 * 静态导出下 useSearchParams 必须包在 Suspense 里。
 */
function TaskUrlSync({ onOpen }: { onOpen: (taskId: string) => void }) {
  const params = useSearchParams();
  const taskId = params.get('task');
  useEffect(() => {
    if (taskId) onOpen(taskId);
  }, [taskId, onOpen]);
  return null;
}

/** 任务页：六列流转（待办 → 进行中 → 待验证 → 验证中 → 已完成 / 已取消）、标签筛选、点卡片看详情 */
export default function TasksPage() {
  const store = useVibeHub();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [labelFilter, setLabelFilter] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const canEdit = useCanEdit();
  const projectId = store.currentProject?.id;

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setTasks(await api.listTasks(projectId));
    } catch {
      // 忽略：保留旧列表，下次刷新再试
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, store.taskRevision]);

  const router = useRouter();
  const closeDetail = () => {
    setDetailId(null);
    // 清掉 ?task=，下次从 ⌘K 点同一个任务还能再打开
    if (window.location.search.includes('task=')) router.replace('/tasks');
  };

  const allLabels = useMemo(() => [...new Set(tasks.flatMap((t) => t.labels))].sort(), [tasks]);
  const visible = labelFilter ? tasks.filter((t) => t.labels.includes(labelFilter)) : tasks;

  if (!store.currentProject) return <NoProject />;

  const move = async (task: Task, to: TaskStatus) => {
    try {
      await api.updateTask(task.id, { status: to });
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
      await load();
      toast.success(`已转为缺陷 ${bug.id.slice(0, 12)}…`, {
        action: { label: '查看', onClick: () => { window.location.href = `/board?bug=${bug.id}`; } },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '转缺陷失败');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
        <CurrentProjectSwitcher />
        <span className="text-xs text-[var(--text-tertiary)]">{visible.length} 个任务</span>
        {allLabels.length > 0 && (
          <select
            className="h-8 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2 text-xs outline-none"
            value={labelFilter}
            onChange={(e) => setLabelFilter(e.target.value)}
            data-testid="task-label-filter"
          >
            <option value="">全部标签</option>
            {allLabels.map((l) => <option key={l} value={l}>#{l}</option>)}
          </select>
        )}
        <div className="flex-1" />
        {canEdit && <NewTaskInput projectId={store.currentProject.id} onCreated={load} />}
      </div>

      <div className="flex-1 overflow-hidden p-4">
        <TaskBoard tasks={visible} canEdit={canEdit} onOpen={setDetailId} onMove={(t, to) => void move(t, to)} />
      </div>

      <Suspense fallback={null}>
        <TaskUrlSync onOpen={setDetailId} />
      </Suspense>
      {detailId && (
        <TaskDetailDialog
          taskId={detailId}
          canEdit={canEdit}
          labelSuggestions={allLabels}
          onClose={closeDetail}
          onChanged={() => void load()}
          onConvertToBug={convertToBug}
        />
      )}
    </div>
  );
}

function NewTaskInput({ projectId, onCreated }: { projectId: string; onCreated: () => Promise<void> }) {
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
    <div className="flex items-center gap-2">
      <input
        className="h-8 w-56 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2.5 text-xs outline-none focus:border-[var(--brand)]"
        placeholder="新任务标题，Enter 添加"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        data-testid="task-new-input"
      />
      <span className="vh-kbd">Enter</span>
    </div>
  );
}

function NoProject() {
  return (
    <div className="vh-empty" style={{ height: '100%' }}>
      <span className="vh-empty-icon"><ListTodo size={28} strokeWidth={1.6} /></span>
      <p className="vh-empty-title">还没有项目</p>
      <p className="vh-empty-hint">任务挂在项目下跟踪待办；也可以随时一键转缺陷</p>
      <button
        className="vh-btn"
        onClick={() => window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'))}
        data-testid="tasks-empty-create"
      >
        <FolderPlus size={14} />
        创建第一个项目
      </button>
    </div>
  );
}
