'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { formatTime, type BugComment, type BugDetail } from '@/lib/api-types';
import { BugMetaFields, BugStatusActions, BugTextFields, Field, type SaveBug } from './BugEditors';
import { BugActivity, BugAttachments } from './BugDetailParts';

interface BugDetailDialogProps {
  bugId: string;
  canEdit: boolean;
  onClose: () => void;
  /** 缺陷被修改或删除后通知看板刷新 */
  onChanged: () => void;
  onOpenText: (attachmentId: string, fileName: string) => void;
}

/** 缺陷详情：所有字段可改、只摆合法的下一步、页内写重开原因、活动流、附件、二次确认删除 */
export function BugDetailDialog({ bugId, canEdit, onClose, onChanged, onOpenText }: BugDetailDialogProps) {
  const toast = useToast();
  const [bug, setBug] = useState<BugDetail | null>(null);
  const [comments, setComments] = useState<BugComment[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);

  const reloadComments = () => api.listComments(bugId).then(setComments).catch(() => undefined);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getBug(bugId), api.listComments(bugId)])
      .then(([detail, list]) => {
        if (cancelled) return;
        setBug(detail);
        setComments(list);
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : '加载失败');
        onClose();
      });
    api.listUsers()
      .then((us) => !cancelled && setMembers(us.filter((u) => u.status === 'active').map((u) => ({ id: u.id, name: u.name }))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bugId]);

  const save: SaveBug = async (patch, done) => {
    try {
      const updated = await api.updateBug(bugId, patch);
      setBug((b) => (b ? { ...b, ...updated, attachments: b.attachments } : b));
      onChanged();
      if ('status' in patch) void reloadComments();
      if (done) toast.success(done);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
      return false;
    }
  };

  const remove = async () => {
    try {
      await api.deleteBug(bugId);
      toast.success('已删除 1 个缺陷');
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="bug-detail">
        {!bug ? (
          <div className="flex items-center justify-center py-10 text-[var(--text-tertiary)]"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <>
            <BugHeader bug={bug} canEdit={canEdit} save={save} />
            <div className="max-h-[56vh] space-y-4 overflow-y-auto pr-1">
              <BugStatusActions bug={bug} disabled={!canEdit} save={save} />
              <BugMetaFields bug={bug} canEdit={canEdit} members={members} save={save} />
              <BugTextFields bug={bug} canEdit={canEdit} save={save} />
              {bug.resolution_notes && <Field label={bug.status === 'closed' ? '关闭原因' : '修复说明'}><p className="whitespace-pre-wrap text-sm">{bug.resolution_notes}</p></Field>}
              {bug.git_commit_hash && (
                <Field label="修复 Commit"><code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs">{bug.git_commit_hash}</code></Field>
              )}
              <BugAttachments attachments={bug.attachments} onOpenText={onOpenText} />
              <BugActivity
                comments={comments}
                canEdit={canEdit}
                onComment={async (content) => {
                  await api.addComment(bugId, content);
                  await reloadComments();
                }}
              />
            </div>
            {canEdit && <DeleteFooter onDelete={remove} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BugHeader({ bug, canEdit, save }: { bug: BugDetail; canEdit: boolean; save: SaveBug }) {
  const [title, setTitle] = useState(bug.title);
  useEffect(() => setTitle(bug.title), [bug.title]);
  return (
    <DialogHeader>
      <DialogTitle className="sr-only">{bug.title}</DialogTitle>
      <input
        className="w-full bg-transparent pr-6 text-base font-semibold leading-snug text-[var(--text-primary)] outline-none disabled:opacity-100"
        value={title}
        disabled={!canEdit}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (!title.trim() || title === bug.title) return setTitle(bug.title);
          void save({ title: title.trim() }, '标题已保存').then((ok) => !ok && setTitle(bug.title));
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        data-testid="bug-detail-title"
      />
      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-[var(--text-tertiary)]">
        <span data-testid="bug-reporter">提出人 {bug.reporter?.name ?? (bug.created_by === 'ai' ? 'AI' : '未记录')}</span>
        <span data-testid="bug-assignee-chip">{bug.assignee ? `负责人 ${bug.assignee.name}` : '未指派'}</span>
        <span>更新于 {formatTime(bug.updated_at)}</span>
        {bug.created_by === 'ai' && <span className="vh-ai-badge"><Sparkles size={9} strokeWidth={2.4} />AI</span>}
      </div>
    </DialogHeader>
  );
}

function DeleteFooter({ onDelete }: { onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
      {confirming ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          删除后无法恢复，确定删除？
          <button className="vh-btn danger h-8 text-xs" onClick={() => void onDelete()} data-testid="bug-delete-confirm">确认删除</button>
          <button className="vh-btn ghost h-8 text-xs" onClick={() => setConfirming(false)}>取消</button>
        </div>
      ) : (
        <button className="vh-btn ghost danger h-8 text-xs" onClick={() => setConfirming(true)} data-testid="bug-delete">
          <Trash2 size={13} />
          删除缺陷
        </button>
      )}
    </div>
  );
}
