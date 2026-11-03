'use client';

import {
  AlertTriangle,
  ArrowRight,
  Inbox,
  Sparkles,
  User,
} from 'lucide-react';
import { BUG_STATUS_LABELS } from '@/lib/api-types';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/lib/task-flow';
import { formatSpan } from '@/lib/stale';
import type { BugStatus } from '@/lib/bug-flow';
import type { TodayItem } from '@/lib/today-types';

export function greeting(hour: number): string {
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function dateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00+08:00`);
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'Asia/Shanghai',
  }).format(d);
}

function statusLabel(item: TodayItem): string {
  return item.kind === 'bug'
    ? BUG_STATUS_LABELS[item.status as BugStatus] ?? item.status
    : TASK_STATUS_LABELS[item.status as TaskStatus] ?? item.status;
}

function statusTone(item: TodayItem): string {
  if (item.stale) return 'bg-[var(--danger)]/12 text-[var(--danger)]';
  if (item.status === 'in_progress' || item.status === 'doing') return 'bg-[var(--brand-soft)] text-[var(--accent)]';
  if (item.status === 'resolved' || item.status === 'review') return 'bg-[var(--warn)]/12 text-[var(--warn)]';
  if (item.status === 'verifying') return 'bg-[var(--accent)]/12 text-[var(--accent)]';
  return 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]';
}

function who(item: TodayItem): string {
  if (!item.actor) return '未记录经手人';
  return item.actor.type === 'ai' ? `AI · ${item.actor.name}` : item.actor.name;
}

export function ActionCard({
  label,
  hint,
  count,
  icon: Icon,
  items,
  now,
  onOpen,
  empty,
  testId,
}: {
  label: string;
  hint: string;
  count: number;
  icon: typeof Inbox;
  items: TodayItem[];
  now: number;
  onOpen: (item: TodayItem) => void;
  empty: string;
  testId: string;
}) {
  return (
    <section className="vh-card flex flex-col p-5" data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="t-caption-4 text-[var(--text-tertiary)]">{label}</p>
          <p className="t-heading-5 mt-1">{count} 件</p>
          <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">{hint}</p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
          <Icon size={17} strokeWidth={1.8} />
        </span>
      </div>

      <div className="mt-4 flex-1 space-y-1">
        {items.length === 0 && <p className="t-caption-2 py-3 text-[var(--text-tertiary)]">{empty}</p>}
        {items.slice(0, 3).map((item) => (
          <button
            key={`${item.kind}-${item.id}`}
            className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--bg-elevated)]"
            onClick={() => onOpen(item)}
          >
            <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs ${statusTone(item)}`}>
              {statusLabel(item)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="t-caption-1 block truncate text-[var(--text-primary)]">{item.title}</span>
              <span className="t-caption-5 block truncate text-[var(--text-tertiary)]">
                {item.project.name} · {who(item)}
              </span>
            </span>
            <span className="t-caption-5 shrink-0 text-[var(--text-tertiary)]">
              {formatSpan(now - new Date(item.since).getTime())}
            </span>
          </button>
        ))}
      </div>

      {items.length > 0 && (
        <button className="t-caption-4 mt-3 flex items-center gap-1 text-[var(--accent)]" onClick={() => onOpen(items[0])}>
          打开第一件 <ArrowRight size={13} />
        </button>
      )}
    </section>
  );
}

export function ActiveRow({ item, now, onOpen }: { item: TodayItem; now: number; onOpen: (item: TodayItem) => void }) {
  const span = formatSpan(now - new Date(item.since).getTime());
  const Icon = item.stale ? AlertTriangle : item.actor?.type === 'ai' ? Sparkles : User;
  return (
    <button
      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--bg-elevated)]"
      onClick={() => onOpen(item)}
      data-testid="today-active-row"
    >
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${statusTone(item)}`}>
        {statusLabel(item)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-caption-1 block truncate text-[var(--text-primary)]">{item.title}</span>
        <span className="t-caption-5 block truncate text-[var(--text-tertiary)]">{item.project.name}</span>
      </span>
      <span className={`t-caption-5 flex shrink-0 items-center gap-1 ${item.stale ? 'text-[var(--danger)]' : 'text-[var(--text-tertiary)]'}`}>
        <Icon size={12} />
        {who(item)} · {span}
      </span>
    </button>
  );
}

export function Metric({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div>
      <p className="t-heading-5">{value}</p>
      <p className="t-caption-5 text-[var(--text-tertiary)]">
        {label} {suffix}
      </p>
    </div>
  );
}

export function TodaySkeleton() {
  return (
    <div className="vh-page" data-testid="today-skeleton">
      <div className="vh-skeleton h-4 w-32" />
      <div className="vh-skeleton mt-3 h-9 w-64" />
      <div className="vh-skeleton mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="vh-card p-5">
            <div className="vh-skeleton h-4 w-24" />
            <div className="vh-skeleton mt-3 h-8 w-16" />
            <div className="mt-5 space-y-2">
              <div className="vh-skeleton h-10 w-full" />
              <div className="vh-skeleton h-10 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
