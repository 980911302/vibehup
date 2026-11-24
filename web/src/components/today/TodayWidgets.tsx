'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Sparkles, User, type LucideIcon } from 'lucide-react';
import { BUG_STATUS_LABELS } from '@/lib/api-types';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/lib/task-flow';
import { formatSpan } from '@/lib/stale';
import { evidenceSummary, hasDeliveryEvidence } from '@/lib/evidence';
import type { BugStatus } from '@/lib/bug-flow';
import type { TodayItem } from '@/lib/today-types';

export function dateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00+08:00`);
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'Asia/Shanghai',
  }).format(d);
}

export function statusLabel(item: TodayItem): string {
  return item.kind === 'bug'
    ? BUG_STATUS_LABELS[item.status as BugStatus] ?? item.status
    : TASK_STATUS_LABELS[item.status as TaskStatus] ?? item.status;
}

export function statusTone(item: TodayItem): string {
  if (item.stale) return 'bg-[var(--danger)]/12 text-[var(--danger)]';
  if (item.status === 'in_progress' || item.status === 'doing') return 'bg-[var(--brand-soft)] text-[var(--brand)]';
  if (item.status === 'resolved' || item.status === 'review') return 'bg-[var(--warn)]/14 text-[var(--warn)]';
  if (item.status === 'verifying') return 'bg-[var(--gold-bg)] text-[var(--gold)]';
  return 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]';
}

function who(item: TodayItem): string {
  if (!item.actor) return item.assignee?.name ?? '未指派';
  return item.actor.type === 'ai' ? `AI · ${item.actor.name}` : item.actor.name;
}

export function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  sub: string;
  icon: LucideIcon;
  accent?: 'warn' | 'gold' | 'ok';
}) {
  const tone =
    accent === 'warn'
      ? 'text-[var(--warn)]'
      : accent === 'gold'
        ? 'text-[var(--gold)]'
        : accent === 'ok'
          ? 'text-[var(--ok)]'
          : 'text-[var(--text-secondary)]';
  return (
    <div className="vh-card flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-[var(--text-tertiary)]">{label}</p>
        <p className="mt-1 text-xl font-semibold leading-tight tracking-tight text-[var(--text-primary)]">{value}</p>
        <p className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]">{sub}</p>
      </div>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] ${tone}`}>
        <Icon size={14} strokeWidth={1.9} />
      </span>
    </div>
  );
}

export function ActionSection({
  title,
  hint,
  count,
  icon: Icon,
  items,
  now,
  onOpen,
  empty,
  testId,
  actionsFor,
}: {
  title: string;
  hint: string;
  count: number;
  icon: typeof Inbox;
  items: TodayItem[];
  now: number;
  onOpen: (item: TodayItem) => void;
  empty: string;
  testId: string;
  actionsFor?: (item: TodayItem) => ReactNode;
}) {
  return (
    <section className="vh-list-surface" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon size={14} className="shrink-0 text-[var(--text-secondary)]" />
          <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h2>
          <span className="hidden truncate text-xs text-[var(--text-tertiary)] sm:inline">{hint}</span>
        </div>
        <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
          {count}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-[var(--text-tertiary)]">{empty}</p>
      ) : (
        <div className="divide-y divide-[var(--border-subtle)]">
          {items.map((item) => {
            const evOk = hasDeliveryEvidence(item.evidence);
            const showEv = !actionsFor && (item.status === 'resolved' || item.status === 'review' || item.status === 'verifying');
            return (
              <div key={`${item.kind}-${item.id}`} className="px-4 py-2.5 transition-colors hover:bg-[var(--bg-elevated)]/60">
                <div
                  role="button"
                  tabIndex={0}
                  className="flex w-full cursor-pointer items-center gap-2.5 text-left"
                  onClick={() => onOpen(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen(item);
                    }
                  }}
                >
                  <span className="shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)]">
                    {item.kind === 'bug' ? '缺陷' : '任务'}
                  </span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${statusTone(item)}`}>
                    {statusLabel(item)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {item.title}
                  </span>
                  {showEv && (
                    <span className={`shrink-0 text-[11px] ${evOk ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}`}>
                      {evOk ? evidenceSummary(item.evidence).slice(0, 2).join(' · ') : '待补证据'}
                    </span>
                  )}
                  <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">
                    {formatSpan(now - new Date(item.since).getTime())}
                  </span>
                </div>
                {actionsFor && <div className="mt-2 pl-0.5">{actionsFor(item)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ActiveRow({ item, now, onOpen }: { item: TodayItem; now: number; onOpen: (item: TodayItem) => void }) {
  const span = formatSpan(now - new Date(item.since).getTime());
  const Icon = item.stale ? AlertTriangle : item.actor?.type === 'ai' ? Sparkles : User;
  return (
    <button
      type="button"
      className="vh-list-row"
      onClick={() => onOpen(item)}
      data-testid="today-active-row"
    >
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${statusTone(item)}`}>
        {statusLabel(item)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">{item.title}</span>
      <span
        className={`flex shrink-0 items-center gap-1 text-[11px] ${
          item.stale ? 'text-[var(--danger)]' : item.actor?.type === 'ai' ? 'text-[var(--gold)]' : 'text-[var(--text-tertiary)]'
        }`}
      >
        <Icon size={12} />
        {who(item)} · {span}
      </span>
    </button>
  );
}

export function TodaySkeleton() {
  return (
    <div className="vh-ws-scroll" data-testid="today-skeleton">
      <div className="vh-ws-container space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="vh-card p-4">
              <div className="vh-skeleton h-3 w-20" />
              <div className="vh-skeleton mt-2.5 h-6 w-14" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="vh-card h-56 p-4" />
          <div className="vh-card h-56 p-4" />
        </div>
      </div>
    </div>
  );
}
