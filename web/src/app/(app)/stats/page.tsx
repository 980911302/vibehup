'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, RefreshCw } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { sortByActorActivity } from '@/lib/stats-view';
import { CurrentProjectSwitcher } from '@/components/layout/CurrentProjectSwitcher';
import { StatsActiveList } from '@/components/stats/StatsActiveList';
import { StatsTrendChart } from '@/components/stats/StatsTrendChart';
import type { StatsActiveItem, StatsResponse } from '@/lib/stats-types';

type Scope = 'current' | 'all';
const POLL_INTERVAL_MS = 30_000;

/** 统计页（R85，docs/计划/07 §7.16）：今天产出、还剩多少、现在谁在做什么、按密钥、14 天趋势 */
export default function StatsPage() {
  const store = useVibeHub();
  // 只取稳定的 error 回调：useToast 返回的整个对象每次 Provider 重渲染都是新引用，
  // 若进 load 依赖会「请求失败→弹 toast→Provider 重渲染→load 变新→再请求」自我循环。
  const { error: toastError } = useToast();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('current');
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const projectId = scope === 'current' ? store.currentProject?.id ?? null : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.stats({ projectId }));
    } catch (e) {
      toastError(e instanceof Error ? e.message : '加载统计失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, toastError]);

  useEffect(() => {
    void load();
  }, [load, store.statsRevision]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const openActiveItem = (item: StatsActiveItem) => {
    if (item.project_id !== store.currentProject?.id) store.selectProject(item.project_id);
    router.push(item.kind === 'bug' ? '/board' : `/tasks?task=${item.id}`);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* 页头 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5">
        <CurrentProjectSwitcher />
        <div className="flex gap-1 rounded-lg bg-[var(--bg-elevated)] p-0.5">
          {(['current', 'all'] as const).map((s) => (
            <button
              key={s}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                scope === s ? 'bg-[var(--bg-page)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)]'
              }`}
              onClick={() => setScope(s)}
              data-testid={`stats-scope-${s}`}
            >
              {s === 'current' ? '当前项目' : '全部项目'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {data && <span className="text-[11px] text-[var(--text-tertiary)]">{data.scope.today}</span>}
        <button className="vh-btn ghost h-8 text-xs" onClick={() => void load()} title="刷新" data-testid="stats-refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      <div className="flex-1 space-y-5 p-4">
        {!data ? (
          <p className="py-10 text-center text-xs text-[var(--text-tertiary)]">加载中…</p>
        ) : (
          <>
            {/* 今天 */}
            <section>
              <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">今天</h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile label="修复完成的缺陷" value={data.today.bugs_fixed} accent="var(--ok)" />
                <Tile label="完成的任务" value={data.today.tasks_done} accent="var(--ok)" />
                <Tile label="新增缺陷" value={data.today.bugs_created} />
                <Tile label="新增任务" value={data.today.tasks_created} />
              </div>
              {data.today.bugs_closed_unfixed > 0 && (
                <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">另有 {data.today.bugs_closed_unfixed} 个缺陷今天按「不修 / 重复」关闭</p>
              )}
            </section>

            {/* 还剩多少 */}
            <section>
              <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">还剩多少</h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Tile label="缺陷·未解决" value={data.remaining.bugs.unresolved} />
                <Tile label="缺陷·未验证" value={data.remaining.bugs.unverified} accent="var(--warn)" />
                <Tile label="任务·待办" value={data.remaining.tasks.todo} />
                <Tile label="任务·进行中" value={data.remaining.tasks.doing} />
                <Tile label="任务·未验收" value={data.remaining.tasks.unverified} accent="var(--warn)" />
              </div>
            </section>

            {/* 现在谁在做什么 */}
            <section>
              <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">现在谁在做什么</h2>
              <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1.5">
                <StatsActiveList items={data.active} onOpen={openActiveItem} />
              </div>
            </section>

            {/* 按密钥 */}
            <section>
              <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">按密钥</h2>
              {data.by_actor.length === 0 ? (
                <p className="py-4 text-center text-xs text-[var(--text-tertiary)]">还没有可归集的经手记录</p>
              ) : (
                <table className="w-full text-xs" data-testid="stats-by-actor-table">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-left text-[10px] text-[var(--text-tertiary)]">
                      <th className="pb-1.5 pl-1 font-medium">经手人</th>
                      <th className="pb-1.5 font-medium">手上缺陷</th>
                      <th className="pb-1.5 font-medium">手上任务</th>
                      <th className="pb-1.5 font-medium">今天修复</th>
                      <th className="pb-1.5 font-medium">今天完成</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortByActorActivity(data.by_actor).map((row) => (
                      <tr key={`${row.type}-${row.name}`} className="border-b border-[var(--border-subtle)]/50">
                        <td className="py-1.5 pl-1 font-medium text-[var(--text-primary)]">
                          {row.name}
                          {row.type === 'ai' && <span className="ml-1.5 rounded bg-[var(--brand-soft)] px-1 py-0.5 text-[9px] text-[var(--brand)]">AI</span>}
                        </td>
                        <td className="py-1.5">{row.in_hand_bugs}</td>
                        <td className="py-1.5">{row.in_hand_tasks}</td>
                        <td className="py-1.5">{row.fixed_today}</td>
                        <td className="py-1.5">{row.done_today}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* 趋势 */}
            <section>
              <h2 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">最近 14 天</h2>
              <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                <StatsTrendChart points={data.trend} />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3.5 py-2.5">
      <p className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]"><BarChart3 size={11} />{label}</p>
      <p className="mt-0.5 text-xl font-semibold" style={{ color: accent ?? 'var(--text-primary)' }}>{value}</p>
    </div>
  );
}