'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, BarChart3, RefreshCw } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { clockLabel, statsDateLabel, todayDone, totalRemaining } from '@/lib/stats-view';
import { StatsActiveList } from '@/components/stats/StatsActiveList';
import { StatsByActor } from '@/components/stats/StatsByActor';
import { StatsEmptyGuide } from '@/components/stats/StatsEmptyGuide';
import { StatsRemainingCard } from '@/components/stats/StatsRemainingCard';
import { StatsTodayCard } from '@/components/stats/StatsTodayCard';
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const hasProject = !!store.currentProject;
  const activeScope: Scope = scope === 'current' && !hasProject ? 'all' : scope;
  const projectId = activeScope === 'current' ? store.currentProject?.id ?? null : null;
  const projectNameById = useMemo(
    () => Object.fromEntries(store.projects.map((p) => [p.id, p.name])),
    [store.projects],
  );
  const staleCount = data?.active.filter((item) => item.stale).length ?? 0;
  const noActivity =
    !!data &&
    data.active.length === 0 &&
    data.by_actor.length === 0 &&
    data.trend.every((p) => p.bugs_fixed === 0 && p.tasks_done === 0) &&
    totalRemaining(data.remaining) === 0 &&
    todayDone(data.today) === 0 &&
    data.today.bugs_closed_unfixed === 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.stats({ projectId }));
      setUpdatedAt(new Date());
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : '加载统计失败';
      setError(message);
      toastError(message);
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
    router.push(item.kind === 'bug' ? `/work/bugs?bug=${item.id}` : `/work/tasks?task=${item.id}`);
  };

  return (
    <div className="vh-page">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="t-caption-4 flex items-center gap-2 text-[var(--text-tertiary)]">
            <BarChart3 size={14} strokeWidth={1.8} /> 今日 · 统计
          </p>
          <h1 className="t-heading-4 mt-2">产出与节奏</h1>
          <p className="t-body-3 mt-2 max-w-[680px] text-[var(--text-secondary)]">
            今天产出多少、还剩多少、谁在做什么；按北京时间统计，每 30 秒刷新。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="vh-segmented" role="group" aria-label="统计范围">
            <button
              className={activeScope === 'current' ? 'active' : undefined}
              onClick={() => setScope('current')}
              disabled={!hasProject && !store.loading}
              title={hasProject || store.loading ? undefined : '还没有进行中的项目'}
              data-testid="stats-scope-current"
            >
              当前项目
            </button>
            <button
              className={activeScope === 'all' ? 'active' : undefined}
              onClick={() => setScope('all')}
              data-testid="stats-scope-all"
            >
              全部项目
            </button>
          </div>
          {updatedAt && (
            <span className="t-caption-5 hidden tabular-nums text-[var(--text-tertiary)] sm:inline">
              {clockLabel(updatedAt)} 更新
            </span>
          )}
          <button className="vh-btn ghost" onClick={() => void load()} title="刷新" data-testid="stats-refresh">
            <RefreshCw size={15} className={loading ? 'animate-spin' : undefined} />
            <span className="hidden sm:inline">刷新</span>
          </button>
        </div>
      </header>

      {!data && error ? (
        <div className="vh-card mt-8">
          <div className="vh-empty">
            <span className="vh-empty-icon">
              <AlertTriangle size={22} className="text-[var(--warn)]" />
            </span>
            <p className="vh-empty-title">统计暂时取不到</p>
            <p className="vh-empty-hint">{error}</p>
            <button className="vh-btn" onClick={() => void load()}>
              <RefreshCw size={15} /> 重试
            </button>
          </div>
        </div>
      ) : !data ? (
        <StatsSkeleton />
      ) : (
        <>
          <div className="mt-8 grid gap-5 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7">
              <StatsTodayCard today={data.today} dateLabel={statsDateLabel(data.scope.today)} />
            </div>
            <div className="min-w-0 lg:col-span-5">
              <StatsRemainingCard remaining={data.remaining} staleCount={staleCount} />
            </div>
          </div>

          {noActivity ? (
            <StatsEmptyGuide onOpenWork={() => router.push('/work')} onOpenToday={() => router.push('/today')} />
          ) : (
            <>
              <section className="vh-card mt-5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="t-title-3">最近 14 天</h2>
                  <span className="t-caption-5 text-[var(--text-tertiary)]">含今天，旧 → 新</span>
                </div>
                <div className="mt-4">
                  <StatsTrendChart points={data.trend} />
                </div>
              </section>

              <div className="mt-5 grid items-start gap-5 lg:grid-cols-12">
                <div className="min-w-0 lg:col-span-7">
                  <StatsActiveList
                    items={data.active}
                    projectNames={activeScope === 'all' ? projectNameById : undefined}
                    onOpen={openActiveItem}
                  />
                </div>
                <div className="min-w-0 lg:col-span-5">
                  <StatsByActor rows={data.by_actor} />
                </div>
              </div>

              <p className="t-caption-5 mt-6 text-center text-[var(--text-tertiary)]">
                修复完成 = 缺陷「已验证」或旧流程「已验证 → 已关闭」；任务完成 = 「已完成」。
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="mt-8" data-testid="stats-skeleton">
      <div className="grid gap-5 lg:grid-cols-12">
        {[7, 5, 7, 5].map((span, i) => (
          <div key={i} className={`vh-card p-6 ${span === 7 ? 'lg:col-span-7' : 'lg:col-span-5'}`}>
            <div className="vh-skeleton h-4 w-24" />
            <div className="vh-skeleton mt-4 h-10 w-20" />
            <div className="vh-skeleton mt-5 h-16 w-full" />
          </div>
        ))}
      </div>
      <div className="vh-card mt-5 p-6">
        <div className="vh-skeleton h-4 w-28" />
        <div className="vh-skeleton mt-4 h-36 w-full" />
      </div>
    </div>
  );
}
