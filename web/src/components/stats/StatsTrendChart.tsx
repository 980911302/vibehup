'use client';

import type { StatsTrendPoint } from '@/lib/stats-types';
import { trendTotals } from '@/lib/stats-view';

const PLOT_HEIGHT = 144;

/**
 * 最近 14 天趋势：每天两根并排柱子（缺陷修复完成 / 任务完成）。
 * 纯 div/flex 自绘，不引图表依赖；金色只留给 AI 标识，系列色走品牌蓝与成功绿。
 */
export function StatsTrendChart({ points }: { points: StatsTrendPoint[] }) {
  const max = Math.max(...points.map((p) => Math.max(p.bugs_fixed, p.tasks_done)), 1);
  const totals = trendTotals(points);
  const hasAny = totals.bugsFixed + totals.tasksDone > 0;
  const total = totals.bugsFixed + totals.tasksDone;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-4">
          <span className="t-caption-5 flex items-center gap-1.5 text-[var(--text-tertiary)]">
            <i className="inline-block h-2 w-2 rounded-sm bg-[var(--accent-color)]" aria-hidden />
            缺陷修复完成 <span className="tabular-nums text-[var(--text-secondary)]">{totals.bugsFixed}</span>
          </span>
          <span className="t-caption-5 flex items-center gap-1.5 text-[var(--text-tertiary)]">
            <i className="inline-block h-2 w-2 rounded-sm bg-[var(--ok)]" aria-hidden />
            任务完成 <span className="tabular-nums text-[var(--text-secondary)]">{totals.tasksDone}</span>
          </span>
        </div>
        <span className="t-caption-5 tabular-nums text-[var(--text-tertiary)]">14 天合计 {total} 件</span>
      </div>

      <div className="mt-4 flex gap-3">
        <div
          className="t-caption-5 flex shrink-0 flex-col justify-between pb-6 text-right tabular-nums text-[var(--text-tertiary)]"
          style={{ height: PLOT_HEIGHT + 24 }}
          aria-hidden
        >
          <span>{max}</span>
          <span>0</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height: PLOT_HEIGHT }} data-testid="stats-trend-chart">
            {[0, 0.5, 1].map((ratio) => (
              <span
                key={ratio}
                className="absolute inset-x-0 border-t border-[var(--border-subtle)]"
                style={{ bottom: `${ratio * 100}%` }}
                aria-hidden
              />
            ))}
            <div className="absolute inset-0 flex items-end gap-1 sm:gap-1.5">
              {points.map((p, i) => {
                const isToday = i === points.length - 1;
                return (
                  <div
                    key={p.date}
                    className={`group relative flex h-full flex-1 items-end gap-0.5 rounded-sm sm:gap-1 ${
                      isToday ? 'bg-[var(--bg-elevated)]/70' : ''
                    }`}
                    title={`${p.date}：修复 ${p.bugs_fixed} 个缺陷，完成 ${p.tasks_done} 个任务`}
                  >
                    <span
                      className="flex-1 rounded-t-[2px] bg-[var(--accent-color)]/70 transition-colors group-hover:bg-[var(--accent-color)]"
                      style={{ height: barHeight(p.bugs_fixed, max) }}
                    />
                    <span
                      className="flex-1 rounded-t-[2px] bg-[var(--ok)]/70 transition-colors group-hover:bg-[var(--ok)]"
                      style={{ height: barHeight(p.tasks_done, max) }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-2 flex gap-1 sm:gap-1.5" aria-hidden>
            {points.map((p, i) => (
              <span
                key={p.date}
                className={`t-caption-5 flex-1 text-center tabular-nums text-[var(--text-tertiary)] ${
                  i === points.length - 1 || i % 2 === 0 ? '' : 'invisible'
                }`}
              >
                {p.date.slice(5)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {!hasAny && (
        <p className="t-caption-5 mt-4 text-[var(--text-tertiary)]">
          最近 14 天还没有完成记录——把缺陷推进到「已验证」、任务推进到「已完成」，趋势会在这里累积。
        </p>
      )}
    </div>
  );
}

/** 0 值也留 2px 基线，避免整列消失；有值时至少 4px 保证可见 */
function barHeight(value: number, max: number): string {
  if (value <= 0) return '2px';
  return `${Math.max(4, (value / max) * 100)}%`;
}
