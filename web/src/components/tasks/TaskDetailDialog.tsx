'use client';

import { useEffect, useState } from 'react';
import { Bug as BugIcon, FileText, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { Task, TaskDetail } from '@/lib/api-types';
import type { TaskStatus } from '@/lib/task-flow';
import { LabelEditor } from './LabelEditor';
import { TaskStatusActions } from './TaskStatusActions';
import { PRIORITY_LABEL } from './TaskCard';

interface TaskDetailDialogProps {
  taskId: string;
  canEdit: boolean;
  labelSuggestions: string[];
  onClose: () => void;
  /** 任务被修改或删除后通知列表刷新 */
  onChanged: () => void;
  onConvertToBug: (task: Task) => Promise<void>;
}

const inputCls = 'w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2.5 text-sm outline-none focus:border-[var(--brand)] disabled:opacity-70';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
}

/** 任务详情：查看与编辑标题、描述、优先级、负责人、标签，按流转规则改状态，删除 */
export function TaskDetailDialog({ taskId, canEdit, labelSuggestions, onClose, onChanged, onConvertToBug }: TaskDetailDialogProps) {
  const toast = useToast();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.getTask(taskId)
      .then((t) => !cancelled && setTask(t))
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : '任务加载失败');
        onClose();
      });
    api.listUsers()
      .then((us) => !cancelled && setMembers(us.filter((u) => u.status === 'active').map((u) => ({ id: u.id, name: u.name }))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  /** 保存并返回是否成功（失败已 toast 提示，不向外抛，避免未捕获的 Promise 拒绝） */
  const save = async (patch: Record<string, unknown>, done?: string): Promise<boolean> => {
    try {
      const updated = await api.updateTask(taskId, patch);
      setTask((t) => (t ? { ...t, ...updated } : t));
      onChanged();
      if (done) toast.success(done);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
      return false;
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="task-detail">
        {!task ? (
          <div className="flex items-center justify-center py-10 text-[var(--text-tertiary)]"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <TaskDetailBody task={task} canEdit={canEdit} members={members} labelSuggestions={labelSuggestions} save={save}
            onDelete={async () => {
              await api.deleteTask(task.id);
              toast.success('任务已删除');
              onChanged();
              onClose();
            }}
            onConvertToBug={async () => {
              await onConvertToBug(task);
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface BodyProps {
  task: TaskDetail;
  canEdit: boolean;
  members: { id: string; name: string }[];
  labelSuggestions: string[];
  save: (patch: Record<string, unknown>, done?: string) => Promise<boolean>;
  onDelete: () => Promise<void>;
  onConvertToBug: () => Promise<void>;
}

function TaskDetailBody({ task, canEdit, members, labelSuggestions, save, onDelete, onConvertToBug }: BodyProps) {
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.description ?? '');
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDesc(task.description ?? ''), [task.description]);
  const descDirty = desc !== (task.description ?? '');

  return (
    <>
      <DialogHeader>
        <DialogTitle className="sr-only">{task.title}</DialogTitle>
        <input
          className="w-full bg-transparent pr-6 text-base font-semibold text-[var(--text-primary)] outline-none disabled:opacity-100"
          value={title}
          disabled={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (!title.trim() || title === task.title) return setTitle(task.title);
            void save({ title: title.trim() }, '标题已保存').then((ok) => !ok && setTitle(task.title));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          data-testid="task-title-input"
        />
        <p className="text-xs text-[var(--text-tertiary)]">创建于 {formatTime(task.created_at)} · 更新于 {formatTime(task.updated_at)}</p>
      </DialogHeader>

      <div className="max-h-[56vh] space-y-4 overflow-y-auto">
        <TaskStatusActions
          task={task}
          disabled={!canEdit}
          onTransition={(to: TaskStatus, reason?: string) => save({ status: to, reopen_reason: reason })}
        />
        {task.reopen_reason && (
          <p className="flex items-start gap-1.5 rounded-md bg-[var(--bg-elevated)] px-2.5 py-2 text-xs text-[var(--warn)]">
            <RotateCcw size={12} className="mt-0.5 shrink-0" />
            上次打回原因：{task.reopen_reason}（累计打回 {task.reopened_count} 次）
          </p>
        )}

        <TaskMeta task={task} canEdit={canEdit} members={members} labelSuggestions={labelSuggestions} save={save} />

        <Field label="描述">
          <textarea
            className={`${inputCls} min-h-28 py-2 leading-relaxed`}
            value={desc}
            disabled={!canEdit}
            placeholder={canEdit ? '补充背景、验收标准、相关链接（支持 Markdown）' : '暂无描述'}
            onChange={(e) => setDesc(e.target.value)}
            data-testid="task-description-input"
          />
          {descDirty && canEdit && (
            <div className="mt-1.5 flex gap-2">
              <button className="vh-btn h-7 text-xs" onClick={() => void save({ description: desc }, '描述已保存')}>保存描述</button>
              <button className="vh-btn ghost h-7 text-xs" onClick={() => setDesc(task.description ?? '')}>撤销修改</button>
            </div>
          )}
        </Field>

        <Field label={`附件（${task.attachments.length}）`}>
          {task.attachments.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)]">暂无附件（AI 可经 MCP 上传后关联到任务）</p>
          ) : (
            <ul className="space-y-1">
              {task.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                  <FileText size={12} />
                  {a.public_url ? <a className="hover:text-[var(--brand)]" href={a.public_url} target="_blank" rel="noreferrer">{a.file_name}</a> : a.file_name}
                </li>
              ))}
            </ul>
          )}
        </Field>
      </div>

      {canEdit && <TaskFooter onDelete={onDelete} onConvertToBug={onConvertToBug} />}
    </>
  );
}

function TaskMeta({ task, canEdit, members, labelSuggestions, save }: Omit<BodyProps, 'onDelete' | 'onConvertToBug'>) {
  const selectCls = 'h-8 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2 text-xs outline-none disabled:opacity-70';
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="优先级">
        <select className={selectCls} value={task.priority} disabled={!canEdit} onChange={(e) => void save({ priority: e.target.value })} data-testid="task-priority-select">
          {(Object.keys(PRIORITY_LABEL) as Task['priority'][]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
      </Field>
      <Field label="负责人">
        <select className={selectCls} value={task.assignee_id ?? ''} disabled={!canEdit} onChange={(e) => void save({ assignee_id: e.target.value || null })} data-testid="task-assignee-select">
          <option value="">未指派</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="标签">
          <LabelEditor value={task.labels} suggestions={labelSuggestions} disabled={!canEdit} onChange={(labels) => void save({ labels })} />
        </Field>
      </div>
    </div>
  );
}

function TaskFooter({ onDelete, onConvertToBug }: { onDelete: () => Promise<void>; onConvertToBug: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
      <button className="vh-btn ghost h-8 text-xs" onClick={() => void onConvertToBug()} title="新建一条缺陷并删除本任务">
        <BugIcon size={13} />
        转为缺陷
      </button>
      {confirming ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          删除后无法恢复，确定删除？
          <button className="vh-btn danger h-8 text-xs" onClick={() => void onDelete()} data-testid="task-delete-confirm">确认删除</button>
          <button className="vh-btn ghost h-8 text-xs" onClick={() => setConfirming(false)}>取消</button>
        </div>
      ) : (
        <button className="vh-btn ghost danger h-8 text-xs" onClick={() => setConfirming(true)} data-testid="task-delete">
          <Trash2 size={13} />
          删除任务
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-[var(--text-tertiary)]">{label}</p>
      {children}
    </div>
  );
}
