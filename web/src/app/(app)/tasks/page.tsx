'use client';

import { useCallback, useEffect, useState } from 'react';
import { FolderPlus, ListTodo, Plus } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { Task } from '@/lib/api-types';

const COLUMNS: { key: Task['status']; label: string }[] = [
  { key: 'todo', label: '待办' },
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '已完成' },
];

const PRIORITY_LABEL: Record<Task['priority'], string> = { low: '低', medium: '中', high: '高' };

/** 任务页（步骤 07 §7.3）：三列 + 流转 + 转缺陷 */
export default function TasksPage() {
  const store = useVibeHub();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const pid = store.currentProject?.id;
    if (!pid) return;
    try {
      setTasks(await api.listTasks(pid));
    } catch {
      // 忽略
    }
  }, [store.currentProject?.id]);

  useEffect(() => {
    void load();
  }, [load, store.board]);

  if (!store.currentProject) {
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

  const move = async (taskId: string, status: Task['status']) => {
    await api.updateTask(taskId, { status });
    await load();
  };

  const convertToBug = async (task: Task) => {
    const bug = await store.createBug({
      title: `[任务转缺陷] ${task.title}`,
      steps_to_reproduce: task.description ?? undefined,
    });
    await api.deleteTask(task.id);
    await load();
    toast.success(`已转为缺陷 ${bug.id.slice(0, 12)}…`, {
      action: { label: '查看', onClick: () => { window.location.href = '/board'; } },
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5">
        <span className="text-xs text-[var(--text-tertiary)]">{store.currentProject.name} · {tasks.length} 个任务</span>
        <div className="flex-1" />
        <input
          className="h-8 w-56 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2.5 text-xs outline-none focus:border-[var(--brand)]"
          placeholder="新任务标题，Enter 添加"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && newTitle.trim()) {
              setAdding(true);
              try {
                await api.createTask({ project_id: store.currentProject!.id, title: newTitle.trim() });
                setNewTitle('');
                await load();
              } finally {
                setAdding(false);
              }
            }
          }}
        />
        <span className="vh-kbd">Enter</span>
      </div>

      <div className="grid flex-1 grid-cols-3 gap-3 overflow-hidden p-4">
        {COLUMNS.map((col) => {
          const list = tasks.filter((t) => t.status === col.key);
          return (
            <div key={col.key} className="flex min-h-32 flex-col rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]" data-testid={`task-column-${col.key}`}>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">{col.label}</span>
                <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]">{list.length}</span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-2">
                {list.map((t) => (
                  <div key={t.id} className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5">
                    <p className="mb-1.5 text-[13px] font-medium text-[var(--text-primary)]">{t.title}</p>
                    {t.description && <p className="mb-1.5 line-clamp-2 text-[11px] text-[var(--text-tertiary)]">{t.description}</p>}
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">{PRIORITY_LABEL[t.priority]}</span>
                      <div className="flex-1" />
                      <select
                        className="h-6 rounded border border-[var(--border-strong)] bg-[var(--bg-page)] px-1 text-[10px] outline-none"
                        value={t.status}
                        onChange={(e) => void move(t.id, e.target.value as Task['status'])}
                      >
                        {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                      <button
                        className="rounded border border-[var(--border-strong)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] cursor-pointer"
                        onClick={() => void convertToBug(t)}
                        title="转为缺陷"
                      >
                        转缺陷
                      </button>
                    </div>
                  </div>
                ))}
                {list.length === 0 && <p className="py-6 text-center text-xs text-[var(--text-tertiary)]">暂无任务</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
