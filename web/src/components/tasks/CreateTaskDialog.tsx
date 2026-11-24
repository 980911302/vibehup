'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { Task } from '@/lib/api-types';
import { LabelEditor } from './LabelEditor';
import { PRIORITY_LABEL } from './TaskCard';

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string | null;
  labelSuggestions?: string[];
  onCreated: (task: Task) => void;
}

const inputCls =
  'w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand)]';

/** 新建任务弹窗：归属当前隔离项目，支持标题、描述、优先级、负责人、标签一次录入 */
export function CreateTaskDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  labelSuggestions = [],
  onCreated,
}: CreateTaskDialogProps) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Task['priority']>('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setPriority('medium');
    setAssigneeId('');
    setLabels([]);
    api
      .listUsers()
      .then((us) => setMembers(us.filter((u) => u.status === 'active').map((u) => ({ id: u.id, name: u.name }))))
      .catch(() => undefined);
  }, [open]);

  const submit = async () => {
    if (!title.trim() || !projectId || busy) return;
    setBusy(true);
    try {
      const task = await api.createTask({
        project_id: projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        assignee_id: assigneeId || null,
        labels,
      });
      toast.success('任务已创建');
      onCreated(task);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建任务失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="create-task-dialog">
        <DialogHeader>
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <span className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 font-medium text-[var(--text-secondary)]">
              {projectName ?? '当前项目'}
            </span>
            <span>· 新建任务</span>
          </div>
          <DialogTitle className="mt-1 text-base">添加研发任务</DialogTitle>
          <DialogDescription className="sr-only">在当前项目下创建任务</DialogDescription>
        </DialogHeader>

        <div
          className="space-y-3"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <div>
            <input
              autoFocus
              className={`${inputCls} h-10 font-medium`}
              placeholder="任务标题（简明写出要交付什么）"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="create-task-title"
            />
          </div>

          <div>
            <textarea
              className={`${inputCls} min-h-24 py-2 leading-relaxed`}
              placeholder="补充背景、验收标准或技术要点（可选，支持 Markdown）"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="create-task-desc"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-tertiary)]">优先级</label>
              <select
                className={`${inputCls} h-9 text-xs`}
                value={priority}
                onChange={(e) => setPriority(e.target.value as Task['priority'])}
                data-testid="create-task-priority"
              >
                {(Object.keys(PRIORITY_LABEL) as Task['priority'][]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-tertiary)]">负责人</label>
              <select
                className={`${inputCls} h-9 text-xs`}
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                data-testid="create-task-assignee"
              >
                <option value="">未指派</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--text-tertiary)]">标签</label>
            <LabelEditor value={labels} suggestions={labelSuggestions} disabled={false} onChange={setLabels} />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
          <span className="text-xs text-[var(--text-tertiary)]">
            <span className="vh-kbd">⌘</span> <span className="vh-kbd">↵</span> 提交
          </span>
          <div className="flex items-center gap-2">
            <button className="vh-btn ghost h-8 text-xs" onClick={() => onOpenChange(false)}>
              取消
            </button>
            <button
              className="vh-btn h-8 text-xs"
              disabled={!title.trim() || busy}
              onClick={() => void submit()}
              data-testid="create-task-submit"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
              创建任务
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
