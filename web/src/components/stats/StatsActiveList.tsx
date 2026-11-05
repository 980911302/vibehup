'use client';

import { AlertTriangle, Sparkles, User, Inbox } from 'lucide-react';
import { formatSpan } from '@/lib/stale';
import { useMinuteClock } from '@/hooks/use-minute-clock';
import { BUG_STATUS_LABELS } from '@/lib/api-types';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/lib/task-flow';
import type { StatsActiveItem } from '@/lib/stats-types';
import type { BugStatus } from '@/lib/bug-flow';

function statusLabel(item: StatsActiveItem): string {
  return item.kind === 'bug'
    ? BUG_STATUS_LABELS[item.status as BugStatus] ?? item.status
    : TASK_STATUS_LABELS[item.status as TaskStatus] ?? item.status;
}

function statusTone(item: StatsActiveItem): string {
  if (item.stale) return 'bg-[var(--danger)]/12 text-[var(--danger)]';
  if (item.status === 'in_progress' || item.status === 'doing') return 'bg-[var(--accent-color)]/12 text-[var(--accent-color)]';
  if (item.status === 'resolved' || item.status === 'review') return 'bg-[var(--warn)]/12 text-[var(--warn)]';
  if (item.status === 'verifying') return 'bg-[var(--accent-color)]/12 text-[var(--accent-color)]';
  return 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]';
}

function ActiveRow({ item, now, onOpen }: { item: StatsActiveItem; now: number; onOpen: (item: StatsActiveItem) => void }) {
  const span = formatSpan(now - new Date(item.since).getTime());
  const ActorIcon = item.actor?.type === 'ai' ? Sparkles : User;
  const who = item.actor ? item.actor.name : '未记录经手人';
  return (
    <button
      className="group flex w-full items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-[var(--bg-elevated)]"
      onClick={() => onOpen(item)}
      data-testid="stats-active-row"
      data-stale={item.stale ? 'true' : 'false'}
    >
      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs ${statusTone(item)}`}>{statusLabel(item)}</span>
      <span className="min-w-0 flex-1">
        <span className="t-caption-1 block truncate text-[var(--text-primary)]">{item.title}</span>
        <span className="t-caption-5 mt-0.5 flex items-center gap-1.5 truncate text-[var(--text-tertiary)]">
          {item.kind === 'bug' ? '缺陷' : '任务'} ·{' '}
          <ActorIcon size={11} strokeWidth={1.8} className={item.actor?.type === 'ai' ? 'text-[var(--gold)]' : undefined} />
          <span className={item.actor?.type === 'ai' ? 'text-[var(--gold)]' : undefined}>{who}</span>
        </span>
      </span>
      <span
        className={`t-caption-5 flex shrink-0 items-center gap-1 tabular-nums ${
          item.stale ? 'text-[var(--danger)]' : 'text-[var(--text-tertiary)]'
        }`}
      >
        {item.stale && <AlertTriangle size={12} strokeWidth={1.8} />}
        {item.stale ? `已停留 ${span}` : span}
      </span>
    </button>
  );
}

/** 现在谁在做什么：状态 + 标题 + 经手人 + 停留时长；卡住的用危险色标出 */
export function StatsActiveList({ items, onOpen }: { items: StatsActiveItem[]; onOpen: (item: StatsActiveItem) => void }) {
  const now = useMinuteClock();
  const staleCount = items.filter((i) => i.stale).length;
  return (
    <section className="vh-card overflow-hidden" data-testid="stats-active">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-6 py-4">
        <div>
          <h2 className="t-title-3">现在谁在做什么</h2>
          <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">经手人 = 最近一次改状态的人；卡住的排前面</p>
        </div>
        <div className="flex items-center gap-2">
          {staleCount > 0 && (
            <span className="t-caption-5 flex items-center gap-1 rounded-full bg-[var(--danger)]/12 px-2 py-1 text-[var(--danger)]">
              <AlertTriangle size={12} strokeWidth={1.8} /> 卡住 {staleCount}
            </span>
          )}
          <span className="t-caption-5 tabular-nums text-[var(--text-tertiary)]">{items.length} 件在办</span>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="vh-empty compact">
          <span className="vh-empty-icon">
            <Inbox size={22} strokeWidth={1.8} />
          </span>
          <p className="vh-empty-title">现在没有正在处理的活</p>
          <p className="vh-empty-hint">AI 接手后，它会连同经手密钥和停留时长出现在这里。</p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border-subtle)]">
          {items.map((item) => (
            <ActiveRow key={`${item.kind}-${item.id}`} item={item} now={now} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}
