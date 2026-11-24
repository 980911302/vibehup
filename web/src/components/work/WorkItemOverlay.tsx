'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useCanEdit } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useVibeHub } from '@/hooks/use-vibehub';
import type { Task } from '@/lib/api-types';
import { BugDetailDialog } from '@/components/bugs/BugDetailDialog';
import { CreateBugDialog } from '@/components/bugs/CreateBugDialog';
import { TaskDetailDialog } from '@/components/tasks/TaskDetailDialog';
import { CreateTaskDialog } from '@/components/tasks/CreateTaskDialog';
import { TextViewer } from '@/components/assets/TextViewer';

export interface WorkOverlayApi {
  openItem: (kind: 'bug' | 'task', id: string) => void;
  openCreateBug: () => void;
  openCreateTask: () => void;
}

const WorkOverlayContext = createContext<WorkOverlayApi | null>(null);

export function useWorkOverlay(): WorkOverlayApi {
  const ctx = useContext(WorkOverlayContext);
  if (!ctx) throw new Error('useWorkOverlay 必须在 WorkItemOverlayProvider 内使用');
  return ctx;
}

/**
 * 全站原地详情与新建宿主：
 * 在概览、统计、通知、命令面板点开任何缺陷/任务时原地弹出详情，绝不强行跳页打断心流。
 */
export function WorkItemOverlayProvider({ children }: { children: ReactNode }) {
  const store = useVibeHub();
  const canEdit = useCanEdit();
  const toast = useToast();

  const [activeItem, setActiveItem] = useState<{ kind: 'bug' | 'task'; id: string } | null>(null);
  const [createBugOpen, setCreateBugOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [textViewer, setTextViewer] = useState<{ id: string; name: string } | null>(null);

  const openCreateBug = useCallback(() => {
    if (!canEdit) return;
    if (!store.currentProject) {
      window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'));
      return;
    }
    setCreateBugOpen(true);
  }, [canEdit, store.currentProject]);

  const openCreateTask = useCallback(() => {
    if (!canEdit) return;
    if (!store.currentProject) {
      window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'));
      return;
    }
    setCreateTaskOpen(true);
  }, [canEdit, store.currentProject]);

  const openItem = useCallback((kind: 'bug' | 'task', id: string) => {
    setActiveItem({ kind, id });
  }, []);

  useEffect(() => {
    const onQuickBug = () => openCreateBug();
    const onQuickTask = () => openCreateTask();
    window.addEventListener('vibehub:quick-capture', onQuickBug);
    window.addEventListener('vibehub:quick-task', onQuickTask);
    return () => {
      window.removeEventListener('vibehub:quick-capture', onQuickBug);
      window.removeEventListener('vibehub:quick-task', onQuickTask);
    };
  }, [openCreateBug, openCreateTask]);

  // 切换当前项目时关闭上一个项目的浮层，保证项目物理隔离
  useEffect(() => {
    setActiveItem(null);
    setTextViewer(null);
  }, [store.currentProject?.id]);

  const convertToBug = useCallback(
    async (task: Task) => {
      try {
        const bug = await store.createBug({
          title: `[任务转缺陷] ${task.title}`,
          steps_to_reproduce: task.description ?? undefined,
          labels: task.labels,
        });
        await api.deleteTask(task.id);
        store.notifyWorkChanged();
        toast.success('已转为缺陷', {
          action: { label: '查看缺陷', onClick: () => setActiveItem({ kind: 'bug', id: bug.id }) },
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '转缺陷失败');
      }
    },
    [store, toast],
  );

  const value = useMemo<WorkOverlayApi>(
    () => ({ openItem, openCreateBug, openCreateTask }),
    [openItem, openCreateBug, openCreateTask],
  );

  return (
    <WorkOverlayContext.Provider value={value}>
      {children}

      {activeItem?.kind === 'bug' && (
        <BugDetailDialog
          bugId={activeItem.id}
          canEdit={canEdit}
          onClose={() => setActiveItem(null)}
          onChanged={() => store.notifyWorkChanged()}
          onOpenText={(id, name) => setTextViewer({ id, name })}
        />
      )}

      {activeItem?.kind === 'task' && (
        <TaskDetailDialog
          taskId={activeItem.id}
          canEdit={canEdit}
          labelSuggestions={[]}
          onClose={() => setActiveItem(null)}
          onChanged={() => store.notifyWorkChanged()}
          onConvertToBug={convertToBug}
        />
      )}

      {store.currentProject && (
        <>
          <CreateBugDialog
            open={createBugOpen}
            onOpenChange={setCreateBugOpen}
            projectName={store.currentProject.name}
            templates={store.templates}
            pendingFiles={[]}
            onConsumePendingFiles={() => undefined}
            onSubmit={async (input) => {
              const bug = await store.createBug(input);
              window.dispatchEvent(new CustomEvent('vibehub:record-created'));
              toast.success('缺陷已录入当前项目');
              return bug;
            }}
            projectId={store.currentProject.id}
          />
          <CreateTaskDialog
            open={createTaskOpen}
            onOpenChange={setCreateTaskOpen}
            projectId={store.currentProject.id}
            projectName={store.currentProject.name}
            onCreated={() => {
              store.notifyWorkChanged();
              window.dispatchEvent(new CustomEvent('vibehub:record-created'));
            }}
          />
        </>
      )}

      {textViewer && (
        <TextViewer
          attachmentId={textViewer.id}
          fileName={textViewer.name}
          onClose={() => setTextViewer(null)}
        />
      )}
    </WorkOverlayContext.Provider>
  );
}
