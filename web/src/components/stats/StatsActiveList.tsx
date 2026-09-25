'use client';

import { AlertTriangle, Sparkles, User } from 'lucide-react';
import { formatSpan } from '@/lib/stale';
import { useMinuteClock } from '@/hooks/use-minute-clock';
import { BUG_STATUS_LABELS } from '@/lib/api-types';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/lib/task-flow';
import type { StatsActiveItem } from '@/lib/stats-types';
import type { BugStatus } from '@/lib/bug-flow';

function statusLabel(item: StatsActiveItem): string {
  return item.kind === 'bug' ? BUG_STATUS_LABELS[item.status as BugStatus] ?? item.status : TASK_STATUS_LABELS[item.status as TaskStatus] ?? item.status;
}

/** 统计页「现在谁在做什么」一行：标题 + 状态 + 经手人 + 停留时长；卡住的标红 */
function ActiveRow({ item, now, onOpen }: { item: StatsActiveItem; now: number; onOpen: (item: StatsActiveItem) => void }) {
  const elapsed = now - new Date(item.since).getTime();
  const span = formatSpan(elapsed);
  const Icon = item.stale ? AlertTriangle : item.actor?.type === 'ai' ? Sparkles : User;
  const who = item.actor ? item.actor.name : '未记录';
  return (
    <button
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--bg-elevated)] cursor-pointer"
      onClick={() => onOpen(item)}
      data-testid="stats-active-row"
      data-stale={item.stale ? 'true' : 'false'}
    >
      <span className={`rounded px-1.5 py-0.5 text-[10px] shrink-0 ${item.stale ? 'bg-[var(--danger)]/15 text-[var(--danger)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'}`}>
        {statusLabel(item)}
      </span>
      <span className="flex-1 truncate text-[var(--text-primary)]">{item.title}</span>
      <span className={`flex shrink-0 items-center gap-1 whitespace-nowrap ${item.stale ? 'text-[var(--danger)]' : 'text-[var(--text-tertiary)]'}`}>
        <Icon size={11} />
        {who} · {item.stale ? `已停留 ${span}` : span}
      </span>
    </button>
  );
}

export function StatsActiveList({ items, onOpen }: { items: StatsActiveItem[]; onOpen: (item: StatsActiveItem) => void }) {
  const now = useMinuteClock();
  if (items.length === 0) {
    return <p className="py-6 text-center text-xs text-[var(--text-tertiary)]">现在没有正在处理或等验证的条目</p>;
  }
  return (
    <div className="space-y-0.5" data-testid="stats-active-list">
      {items.map((item) => (
        <ActiveRow key={`${item.kind}-${item.id}`} item={item} now={now} onOpen={onOpen} />
      ))}
    </div>
  );
}