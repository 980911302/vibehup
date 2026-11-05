'use client';

import { Bug, CheckCircle2, ListChecks } from 'lucide-react';
import type { StatsToday } from '@/lib/stats-types';
import { todayDone } from '@/lib/stats-view';

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Bug;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--ok)]/10 text-[var(--ok)]">
        <Icon size={17} strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <p className="t-heading-6 tabular-nums leading-none">{value}</p>
        <p className="t-caption-5 mt-1 truncate text-[var(--text-tertiary)]">{label}</p>
      </div>
    </div>
  );
}

/** 今天产出的主卡：一个总量 + 两项完成拆分 + 新增/关闭备注 */
export function StatsTodayCard({ today, dateLabel }: { today: StatsToday; dateLabel: string }) {
  const done = todayDone(today);
  return (
    <section className="vh-card h-full p-6" data-testid="stats-today">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="t-caption-4 flex items-center gap-2 text-[var(--text-tertiary)]">
            <CheckCircle2 size={14} strokeWidth={1.8} /> 今天
          </p>
          <div className="mt-4 flex items-end gap-2.5">
            <span className="t-heading-2 tabular-nums leading-none">{done}</span>
            <span className="t-body-5 pb-1 text-[var(--text-secondary)]">件完成</span>
          </div>
          <p className="t-caption-5 mt-2 text-[var(--text-tertiary)]">{dateLabel} · 北京时间自然日</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--border-subtle)] pt-5">
        <MiniStat icon={Bug} label="修复完成的缺陷" value={today.bugs_fixed} />
        <MiniStat icon={ListChecks} label="完成的任务" value={today.tasks_done} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border-subtle)] pt-4">
        <p className="t-caption-5 text-[var(--text-tertiary)]">
          新增缺陷 <span className="tabular-nums text-[var(--text-secondary)]">{today.bugs_created}</span>
        </p>
        <p className="t-caption-5 text-[var(--text-tertiary)]">
          新增任务 <span className="tabular-nums text-[var(--text-secondary)]">{today.tasks_created}</span>
        </p>
        {today.bugs_closed_unfixed > 0 && (
          <p className="t-caption-5 text-[var(--text-tertiary)]">
            不修 / 重复关闭 <span className="tabular-nums text-[var(--text-secondary)]">{today.bugs_closed_unfixed}</span>
          </p>
        )}
      </div>
      {done === 0 && (
        <p className="t-caption-5 mt-3 text-[var(--text-tertiary)]">
          还没有完成记录——把卡片推进到「已验证 / 已完成」，这里就会开始计数。
        </p>
      )}
    </section>
  );
}
