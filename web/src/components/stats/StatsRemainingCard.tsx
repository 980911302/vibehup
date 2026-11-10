'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import type { StatsRemaining } from '@/lib/stats-types';
import { remainingGroups, totalRemaining, type RemainingTone } from '@/lib/stats-view';

const BAR_TONE: Record<RemainingTone, string> = {
  brand: 'bg-[var(--accent-color)]',
  warn: 'bg-[var(--warn)]',
  muted: 'bg-[var(--text-tertiary)]',
};

const DOT_TONE: Record<RemainingTone, string> = {
  brand: 'bg-[var(--accent-color)]',
  warn: 'bg-[var(--warn)]',
  muted: 'bg-[var(--text-tertiary)]',
};

function RiskChip({ children }: { children: ReactNode }) {
  return (
    <span className="t-caption-5 inline-flex items-center gap-1 rounded-full bg-[var(--danger)]/12 px-2 py-0.5 text-[var(--danger)]">
      <AlertTriangle size={11} strokeWidth={1.8} /> {children}
    </span>
  );
}

/** 还剩多少：总量 + 紧急/卡住提示 + 缺陷/任务两组堆叠条，空态也保留结构 */
export function StatsRemainingCard({ remaining, staleCount = 0 }: { remaining: StatsRemaining; staleCount?: number }) {
  const total = totalRemaining(remaining);
  const groups = remainingGroups(remaining);

  return (
    <section className="vh-card h-full p-6" data-testid="stats-remaining">
      <p className="t-caption-4 flex items-center gap-2 text-[var(--text-tertiary)]">
        <CircleDashed size={14} strokeWidth={1.8} /> 还剩多少
      </p>
      <div className="mt-4 flex items-end gap-2.5">
        <span className="t-heading-2 tabular-nums leading-none">{total}</span>
        <span className="t-body-5 pb-1 text-[var(--text-secondary)]">件未收尾</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="t-caption-5 text-[var(--text-tertiary)]">未解决、未验证、待办与进行中都在内</p>
        {staleCount > 0 && <RiskChip>{staleCount} 件卡住</RiskChip>}
      </div>

      <div className="mt-6 space-y-5">
        {groups.map((group) => (
          <div key={group.kind}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="t-caption-3 text-[var(--text-primary)]">{group.label}</p>
              <p className="t-caption-5 flex items-center gap-2 tabular-nums text-[var(--text-tertiary)]">
                {group.urgent > 0 && <span className="text-[var(--danger)]">紧急 {group.urgent}</span>}
                共 {group.total}
              </p>
            </div>
            <div
              className="mt-2 flex h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]"
              role="img"
              aria-label={`${group.label}剩余 ${group.total} 件，其中紧急 ${group.urgent} 件`}
            >
              {group.segments.map((s) =>
                s.count > 0 ? (
                  <span
                    key={s.key}
                    className={`${BAR_TONE[s.tone]} h-full`}
                    style={{ width: `${(s.count / Math.max(group.total, 1)) * 100}%` }}
                    title={`${group.label}·${s.label} ${s.count}`}
                  />
                ) : null,
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {group.segments.map((s) => (
                <span key={s.key} className="t-caption-5 flex items-center gap-1.5 text-[var(--text-tertiary)]">
                  <i className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_TONE[s.tone]}`} aria-hidden />
                  {s.label}
                  <span className="tabular-nums text-[var(--text-secondary)]">{s.count}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {total === 0 && (
        <p className="t-caption-5 mt-5 flex items-center gap-2 text-[var(--ok)]">
          <CheckCircle2 size={14} strokeWidth={1.8} /> 没有遗留的缺陷和任务，今天很干净。
        </p>
      )}
    </section>
  );
}
