'use client';

import { MessageCircle, Paperclip, RotateCcw } from 'lucide-react';
import { BUG_STATUS_LABELS, SEVERITY_LABELS, formatTime, type Bug, type BugBoard } from '@/lib/api-types';
import { BUG_STATUSES, isBugOverdue } from '@/lib/bug-flow';
import { HandlingLine } from '@/components/activity/HandlingLine';
import { cn } from '@/lib/utils';

const SEVERITY_DOT: Record<Bug['severity'], string> = {
  low: 'var(--sev-low)',
  normal: 'var(--sev-normal)',
  high: 'var(--sev-high)',
  critical: 'var(--sev-critical)',
};

interface BugListViewProps {
  board: BugBoard;
  hideTerminal: boolean;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onOpenBug: (bugId: string) => void;
  onContextMenu: (bugId: string, e: React.MouseEvent) => void;
}

/** 缺陷紧凑列表视图（Linear 风格高密度行）：适合快速扫读大量缺陷 */
export function BugListView({
  board,
  hideTerminal,
  selectedIds,
  onSelectionChange,
  onOpenBug,
  onContextMenu,
}: BugListViewProps) {
  const statuses = hideTerminal ? BUG_STATUSES.filter((s) => s !== 'verified' && s !== 'closed') : BUG_STATUSES;
  const rows = statuses.flatMap((status) => (board[status] ?? []).map((bug) => ({ bug, status })));
  const selected = new Set(selectedIds);

  if (rows.length === 0) {
    return (
      <div className="vh-list-surface px-4 py-14 text-center">
        <p className="text-sm font-medium text-[var(--text-secondary)]">当前筛选条件下没有缺陷</p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">按 C 或点击右上角「录缺陷」录入新问题</p>
      </div>
    );
  }

  return (
    <div className="vh-list-surface" data-testid="bug-list-view">
      <div className="hidden grid-cols-[90px_1fr_140px_90px_84px] items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]/60 px-4 py-2 text-[11px] font-medium text-[var(--text-tertiary)] md:grid">
        <span>状态</span>
        <span>缺陷标题与标签</span>
        <span>当前经手</span>
        <span>负责人</span>
        <span className="text-right">期限 / 更新</span>
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {rows.map(({ bug, status }) => {
          const overdue = isBugOverdue(bug);
          const isSelected = selected.has(bug.id);
          return (
            <div
              key={bug.id}
              data-testid="bug-card"
              data-bug-id={bug.id}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  const next = new Set(selected);
                  next.has(bug.id) ? next.delete(bug.id) : next.add(bug.id);
                  onSelectionChange([...next]);
                  return;
                }
                if (selected.size > 0) onSelectionChange([]);
                onOpenBug(bug.id);
              }}
              onContextMenu={(e) => onContextMenu(bug.id, e)}
              className={cn(
                'grid cursor-pointer grid-cols-1 items-center gap-2 px-4 py-2.5 transition-colors hover:bg-[var(--bg-elevated)] md:grid-cols-[90px_1fr_140px_90px_84px] md:gap-3',
                isSelected && 'bg-[var(--gold-bg)]/40',
              )}
            >
              <div className="flex items-center gap-2">
                <i className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_DOT[bug.severity] }} title={SEVERITY_LABELS[bug.severity]} />
                <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                  {BUG_STATUS_LABELS[status]}
                </span>
              </div>

              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">{bug.title}</span>
                {bug.created_by === 'ai' && <span className="vh-ai-badge shrink-0">AI</span>}
                {bug.labels.slice(0, 2).map((l) => (
                  <span key={l} className="hidden shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)] sm:inline">
                    #{l}
                  </span>
                ))}
                {bug.attachment_count > 0 && (
                  <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-[var(--text-tertiary)]">
                    <Paperclip size={11} />
                    {bug.attachment_count}
                  </span>
                )}
                {bug.comment_count > 0 && (
                  <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-[var(--text-tertiary)]">
                    <MessageCircle size={11} />
                    {bug.comment_count}
                  </span>
                )}
                {bug.reopened_count > 0 && (
                  <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-[var(--warn)]">
                    <RotateCcw size={11} />
                    {bug.reopened_count}
                  </span>
                )}
              </div>

              <div className="min-w-0 truncate">
                <HandlingLine item={bug} />
              </div>

              <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                {bug.assignee ? (
                  <>
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[11px] font-semibold text-[var(--brand)]"
                      title={`负责人 ${bug.assignee.name}`}
                      data-testid="bug-assignee-avatar"
                    >
                      {bug.assignee.name.slice(0, 1)}
                    </span>
                    <span className="truncate text-xs">{bug.assignee.name}</span>
                  </>
                ) : (
                  <span className="text-xs text-[var(--text-tertiary)]" data-testid="bug-assignee-empty">
                    未指派
                  </span>
                )}
              </div>

              <div className="text-right text-[11px] text-[var(--text-tertiary)]">
                {bug.due_date ? (
                  <span className={overdue ? 'text-[var(--danger)]' : undefined} data-testid="bug-due">
                    {overdue ? '逾期 ' : '截止 '}
                    {bug.due_date.slice(5, 10)}
                  </span>
                ) : (
                  <span>{formatTime(bug.updated_at).slice(5, 16)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
