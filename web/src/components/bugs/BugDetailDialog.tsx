'use client';

import { useEffect, useState } from 'react';
import { Loader2, MessageSquarePlus, Sparkles, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { BUG_STATUS_LABELS, PRIORITY_LABELS, SEVERITY_LABELS, formatSize, formatTime, isImage, isText, type Attachment, type Bug } from '@/lib/api-types';

interface BugDetailDialogProps {
  bugId: string;
  canEdit: boolean;
  onClose: () => void;
  onUpdate: (bugId: string, patch: Record<string, unknown>) => void;
  onDelete: (bugId: string) => void;
  onRefreshBoard: () => void;
  onOpenText: (attachmentId: string, fileName: string) => void;
}

/** 缺陷详情：完整字段 + 活动流评论 + 附件网格（闭环①的人机对话界面） */
export function BugDetailDialog({
  bugId, canEdit, onClose, onUpdate, onDelete, onRefreshBoard, onOpenText,
}: BugDetailDialogProps) {
  const toast = useToast();
  const [bug, setBug] = useState<(Bug & { attachments: Attachment[] }) | null>(null);
  const [comments, setComments] = useState<Awaited<ReturnType<typeof api.listComments>>>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);

  // 成员列表（改派下拉用）
  useEffect(() => {
    api.listUsers()
      .then((us) => setMembers(us.filter((u) => u.status === 'active').map((u) => ({ id: u.id, name: u.name }))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [detail, list] = await Promise.all([api.getBug(bugId), api.listComments(bugId)]);
        if (cancelled) return;
        setBug(detail);
        setComments(list);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载失败');
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bugId]);

  const submitComment = async () => {
    if (!commentDraft.trim()) return;
    await api.addComment(bugId, commentDraft.trim());
    setComments(await api.listComments(bugId));
    setCommentDraft('');
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {loading && !bug && (
          <div className="flex items-center justify-center py-10 text-[var(--text-tertiary)]">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {bug && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 text-base leading-snug">{bug.title}</DialogTitle>
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-[var(--text-tertiary)]">
                <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{SEVERITY_LABELS[bug.severity]}</span>
                <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{BUG_STATUS_LABELS[bug.status]}</span>
                {bug.priority !== 'medium' && <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">优先级 {PRIORITY_LABELS[bug.priority]}</span>}
                <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5" data-testid="bug-assignee-chip">
                  {bug.assignee ? `负责人 ${bug.assignee.name}` : '未指派'}
                </span>
                {bug.due_date && <span className={new Date(bug.due_date) < new Date() ? 'text-[var(--danger)]' : undefined}>截止 {formatTime(bug.due_date).slice(0, 10)}</span>}
                <span>更新于 {formatTime(bug.updated_at)}</span>
                {bug.created_by === 'ai' && <span className="vh-ai-badge"><Sparkles size={9} strokeWidth={2.4} />AI</span>}
              </div>
            </DialogHeader>

            <div className="max-h-[52vh] space-y-4 overflow-y-auto">
              {bug.steps_to_reproduce && <Field label="复现步骤"><p className="whitespace-pre-wrap text-sm">{bug.steps_to_reproduce}</p></Field>}
              {bug.expected_result && <Field label="期望结果"><p className="text-sm">{bug.expected_result}</p></Field>}
              {bug.actual_result && <Field label="实际结果"><p className="text-sm">{bug.actual_result}</p></Field>}
              {bug.resolution_notes && <Field label="修复说明"><p className="text-sm">{bug.resolution_notes}</p></Field>}
              {bug.git_commit_hash && (
                <Field label="修复 Commit">
                  <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs">{bug.git_commit_hash}</code>
                </Field>
              )}

              <Field label={`附件（${bug.attachments.length}）`}>
                {bug.attachments.length === 0 ? (
                  <p className="text-xs text-[var(--text-tertiary)]">暂无附件</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {bug.attachments.map((a) => (
                      <div key={a.id} className="group relative">
                        {isImage(a) ? (
                          <a href={a.public_url ?? '#'} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a.public_url ?? ''} alt={a.file_name}
                              className="aspect-[4/3] w-full rounded-md border border-[var(--border-subtle)] object-cover" />
                          </a>
                        ) : isText(a) ? (
                          <button
                            className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 text-center text-[10px] text-[var(--text-tertiary)] hover:border-[var(--brand)] cursor-pointer"
                            onClick={() => onOpenText(a.id, a.file_name)}
                          >
                            <span className="line-clamp-2 break-all">{a.file_name}</span>
                            <span className="text-[var(--brand)]">在线查看</span>
                          </button>
                        ) : (
                          <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 text-center text-[10px] text-[var(--text-tertiary)]">
                            {a.file_name} · {formatSize(a.file_size)}
                          </div>
                        )}
                        {a.uploaded_by?.startsWith('key_') && (
                          <span className="vh-ai-badge absolute left-1 top-1 scale-90" title="MCP 密钥上传"><Sparkles size={9} strokeWidth={2.4} />AI</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Field>

              <Field label={`活动流（${comments.length}）`}>
                <div className="space-y-2">
                  {comments.map((c) => (
                    <div key={c.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5">
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
                        {c.author_type === 'ai' ? (
                          <span className="vh-ai-badge"><Sparkles size={9} strokeWidth={2.4} />AI{c.author_name ? ` · ${c.author_name}` : ''}</span>
                        ) : (
                          <span className="font-medium text-[var(--text-secondary)]">{c.author_name ?? '成员'}</span>
                        )}
                        <span>{formatTime(c.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{c.content}</p>
                    </div>
                  ))}
                  {comments.length === 0 && <p className="text-xs text-[var(--text-tertiary)]">暂无动态</p>}
                </div>
              </Field>

              {canEdit && (
                <div className="flex gap-2">
                  <input
                    className="flex h-9 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none focus:border-[var(--brand)]"
                    placeholder="写下修复过程或追问…"
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitComment()}
                  />
                  <button className="vh-btn" onClick={submitComment} disabled={!commentDraft.trim()}>
                    <MessageSquarePlus size={14} />
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
              <div className="flex flex-wrap items-center gap-1">
                {canEdit && (
                  <select
                    className="mr-1 h-7 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-1.5 text-[11px] outline-none"
                    value={bug.assignee_id ?? ''}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      onUpdate(bug.id, { assignee_id: v });
                      onRefreshBoard();
                      setBug((b) => (b ? { ...b, assignee_id: v, assignee: v ? (members.find((m) => m.id === v) ?? b.assignee) : null } : b));
                    }}
                    data-testid="bug-reassign-select"
                  >
                    <option value="">未指派</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                )}
                {(['open', 'in_progress', 'resolved', 'verified', 'closed'] as const).map((s) => (
                  <button
                    key={s}
                    disabled={!canEdit || bug.status === s}
                    className={`rounded-md border px-2 py-1 text-xs transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40 ${
                      bug.status === s ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
                        : 'border-[var(--border-strong)] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)]'
                    }`}
                    onClick={() => {
                      const patch: Record<string, unknown> = { status: s };
                      // 回流到 open/in_progress 需要重开原因
                      if (['resolved', 'verified', 'closed'].includes(bug.status) && ['open', 'in_progress'].includes(s)) {
                        const reason = window.prompt('请填写重开原因');
                        if (!reason) return;
                        patch.reopen_reason = reason;
                      }
                      onUpdate(bug.id, patch);
                      onRefreshBoard();
                    }}
                  >
                    {BUG_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
              {canEdit && (
                <button
                  className="vh-btn ghost text-[var(--danger)]"
                  onClick={() => {
                    onDelete(bug.id);
                    onClose();
                  }}
                >
                  <Trash2 size={14} />
                  删除
                </button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
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
