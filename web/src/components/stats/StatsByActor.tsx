'use client';

import { Sparkles, UserRound } from 'lucide-react';
import { sortByActorActivity } from '@/lib/stats-view';
import type { StatsByActor } from '@/lib/stats-types';

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function Count({ value }: { value: number }) {
  return <span className={`tabular-nums ${value > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>{value}</span>;
}

function activity(row: StatsByActor): number {
  return row.in_hand_bugs + row.in_hand_tasks + row.fixed_today + row.done_today;
}

function Identity({ row }: { row: StatsByActor }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
          row.type === 'ai' ? 'bg-[var(--gold-bg)] text-[var(--gold)]' : 'bg-[var(--brand-soft)] text-[var(--accent-color)]'
        }`}
        aria-hidden
      >
        {initial(row.name)}
      </span>
      <span className="t-caption-1 min-w-0 truncate text-[var(--text-primary)]">{row.name}</span>
      {row.type === 'ai' && (
        <span className="vh-ai-badge shrink-0">
          <Sparkles size={10} strokeWidth={1.8} /> AI
        </span>
      )}
    </span>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex flex-col items-center gap-0.5">
      <span className={`t-caption-1 tabular-nums ${value > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>{value}</span>
      <span className="text-[10px] leading-3 text-[var(--text-tertiary)]">{label}</span>
    </span>
  );
}

/** 按经手人归集：AI 显示密钥名，人显示用户名；全 0 的行 API 已过滤 */
export function StatsByActor({ rows }: { rows: StatsByActor[] }) {
  const sorted = sortByActorActivity(rows);
  const aiTotal = sorted.filter((r) => r.type === 'ai').reduce((sum, r) => sum + activity(r), 0);
  const humanTotal = sorted.filter((r) => r.type === 'user').reduce((sum, r) => sum + activity(r), 0);
  return (
    <section className="vh-card overflow-hidden" data-testid="stats-by-actor">
      <div className="border-b border-[var(--border-subtle)] px-5 py-4 sm:px-6">
        <h2 className="t-title-3">按密钥</h2>
        <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">AI 显示密钥名，人显示用户名；按活跃度排序</p>
      </div>
      {sorted.length === 0 ? (
        <div className="vh-empty compact">
          <span className="vh-empty-icon">
            <UserRound size={22} strokeWidth={1.8} />
          </span>
          <p className="vh-empty-title">还没有可归集的经手记录</p>
          <p className="vh-empty-hint">人或者 AI 把卡片推进状态后，这里会按密钥/用户名归集。</p>
        </div>
      ) : (
        <>
          {/* 窄屏：每人一行，数值平铺，避免表格横向截断 */}
          <ul className="divide-y divide-[var(--border-subtle)] sm:hidden" data-testid="stats-by-actor-list">
            {sorted.map((row) => (
              <li key={`${row.type}-${row.name}`} className="px-5 py-3">
                <Identity row={row} />
                <div className="mt-2.5 grid grid-cols-4 gap-2">
                  <Mini label="手上缺陷" value={row.in_hand_bugs} />
                  <Mini label="手上任务" value={row.in_hand_tasks} />
                  <Mini label="今天修复" value={row.fixed_today} />
                  <Mini label="今天完成" value={row.done_today} />
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[420px] text-left" data-testid="stats-by-actor-table">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[var(--text-tertiary)]">
                  <th className="t-caption-5 py-2 pl-6 pr-3 font-medium">经手人</th>
                  <th className="t-caption-5 px-2 py-2 text-right font-medium">手上缺陷</th>
                  <th className="t-caption-5 px-2 py-2 text-right font-medium">手上任务</th>
                  <th className="t-caption-5 px-2 py-2 text-right font-medium">今天修复</th>
                  <th className="t-caption-5 py-2 pl-2 pr-6 text-right font-medium">今天完成</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr
                    key={`${row.type}-${row.name}`}
                    className="border-b border-[var(--border-subtle)]/60 last:border-0 hover:bg-[var(--bg-elevated)]/50"
                  >
                    <td className="py-2.5 pl-6 pr-3">
                      <Identity row={row} />
                    </td>
                    <td className="t-caption-1 px-2 py-2.5 text-right">
                      <Count value={row.in_hand_bugs} />
                    </td>
                    <td className="t-caption-1 px-2 py-2.5 text-right">
                      <Count value={row.in_hand_tasks} />
                    </td>
                    <td className="t-caption-1 px-2 py-2.5 text-right">
                      <Count value={row.fixed_today} />
                    </td>
                    <td className="t-caption-1 py-2.5 pl-2 pr-6 text-right">
                      <Count value={row.done_today} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {sorted.length > 0 && (
        <div className="t-caption-5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-5 py-3 text-[var(--text-tertiary)] sm:px-6">
          <span>{sorted.length} 位经手人</span>
          <span>
            AI 经手 <span className="tabular-nums text-[var(--text-secondary)]">{aiTotal}</span> 件 · 人经手{' '}
            <span className="tabular-nums text-[var(--text-secondary)]">{humanTotal}</span> 件
          </span>
        </div>
      )}
    </section>
  );
}
