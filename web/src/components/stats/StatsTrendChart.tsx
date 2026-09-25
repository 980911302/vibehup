'use client';

import type { StatsTrendPoint } from '@/lib/stats-types';

/**
 * 最近 14 天趋势：每天两根并排柱子（缺陷修复完成 / 任务完成）。
 * 与 KeyUsageChart（keys 页）同款 flex/div 高度柱状图写法，不引新依赖。
 */
export function StatsTrendChart({ points }: { points: StatsTrendPoint[] }) {
  const max = Math.max(...points.map((p) => Math.max(p.bugs_fixed, p.tasks_done)), 1);
  const hasAny = points.some((p) => p.bugs_fixed > 0 || p.tasks_done > 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]">
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-[var(--gold)]" />缺陷修复完成</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-[var(--brand)]" />任务完成</span>
      </div>
      {!hasAny && <p className="py-6 text-center text-xs text-[var(--text-tertiary)]">最近 14 天还没有完成记录</p>}
      <div className="flex h-28 items-end gap-1.5" data-testid="stats-trend-chart">
        {points.map((p) => (
          <div key={p.date} className="group relative flex flex-1 flex-col items-center gap-0.5">
            <div className="flex h-full w-full items-end gap-0.5">
              <div
                className="flex-1 rounded-t bg-[var(--gold)]/70 transition-all hover:bg-[var(--gold)]"
                style={{ height: `${Math.max(2, (p.bugs_fixed / max) * 100)}%` }}
                title={`${p.date}：修复 ${p.bugs_fixed} 个缺陷`}
              />
              <div
                className="flex-1 rounded-t bg-[var(--brand)]/70 transition-all hover:bg-[var(--brand)]"
                style={{ height: `${Math.max(2, (p.tasks_done / max) * 100)}%` }}
                title={`${p.date}：完成 ${p.tasks_done} 个任务`}
              />
            </div>
            <span className="hidden text-[9px] text-[var(--text-tertiary)] group-hover:block">{p.date.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}