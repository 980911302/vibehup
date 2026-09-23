'use client';

import { MessageCircle, Paperclip, RotateCcw, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SEVERITY_LABELS, formatTime, type Bug } from '@/lib/api-types';

const SEVERITY_DOT: Record<Bug['severity'], string> = {
  low: 'var(--sev-low)',
  normal: 'var(--sev-normal)',
  high: 'var(--sev-high)',
  critical: 'var(--sev-critical)',
};

interface BugCardProps {
  bug: Bug;
  thumbnailUrl?: string | null;
  selected?: boolean;
  dragging?: boolean;
  flash?: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

/** 缺陷卡片（UI 规范 §2.6：严重度左缘 3px 色条 + AI 星尘徽章 + 落位回弹） */
export function BugCard({
  bug, thumbnailUrl, selected, dragging, flash,
  onDragStart, onDragEnd, onClick, onContextMenu,
}: BugCardProps) {
  const isOverdue = bug.due_date && new Date(bug.due_date).getTime() < Date.now() && bug.status !== 'resolved' && bug.status !== 'closed' && bug.status !== 'verified';

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-testid="bug-card"
      data-bug-id={bug.id}
      className={cn(
        'group relative cursor-grab rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5 shadow-sm transition-all',
        'hover:-translate-y-px hover:shadow-md active:cursor-grabbing',
        dragging && 'scale-[1.02] opacity-40 shadow-lg',
        selected && 'ring-2 ring-[var(--gold)]',
        flash && 'animate-[vh-card-in_240ms_var(--ease-spring)]',
      )}
      style={{ borderLeft: `3px solid ${SEVERITY_DOT[bug.severity]}` }}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-[var(--text-primary)]">{bug.title}</p>
        <div className="flex shrink-0 items-center gap-1">
          {bug.assignee ? (
            <span
              className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--brand-soft)] text-[10px] font-semibold text-[var(--brand)]"
              title={`负责人 ${bug.assignee.name}`}
              data-testid="bug-assignee-avatar"
            >
              {bug.assignee.name.slice(0, 1)}
            </span>
          ) : (
            <span
              className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-dashed border-[var(--border-strong)] text-[10px] text-[var(--text-tertiary)]"
              title="未指派负责人"
              data-testid="bug-assignee-empty"
            >
              +
            </span>
          )}
          {bug.created_by === 'ai' && (
            <span className="vh-ai-badge" title="AI 创建/更新的缺陷">AI</span>
          )}
        </div>
      </div>

      {thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnailUrl} alt="" loading="lazy"
          className="mb-1.5 aspect-[4/3] w-full rounded-lg border border-[var(--border-subtle)] object-cover" />
      )}

      {bug.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {bug.labels.slice(0, 3).map((l) => (
            <span key={l} className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">#{l}</span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-[var(--text-tertiary)]">
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: SEVERITY_DOT[bug.severity] }} />
            {SEVERITY_LABELS[bug.severity]}
          </span>
          {bug.attachment_count > 0 && (
            <span className="flex items-center gap-0.5" title={`${bug.attachment_count} 个附件`}>
              <Paperclip className="h-3 w-3" />{bug.attachment_count}
            </span>
          )}
          {bug.reopened_count > 0 && (
            <span className="flex items-center gap-0.5 text-[var(--warn)]" title={`被打回 ${bug.reopened_count} 次`}>
              <RotateCcw className="h-3 w-3" />{bug.reopened_count}
            </span>
          )}
          {bug.comment_count > 0 && (
            <span className="flex items-center gap-0.5" title={`${bug.comment_count} 条评论`}>
              <MessageCircle size={11} />
              {bug.comment_count}
            </span>
          )}
        </span>
        <span className={isOverdue ? 'text-[var(--danger)]' : undefined}>
          {isOverdue ? '逾期 ' : ''}
          {formatTime(bug.updated_at).slice(5, 16)}
        </span>
      </div>
    </div>
  );
}
