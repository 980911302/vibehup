'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, BarChart3, FolderPlus, RefreshCw } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useWorkOverlay } from '@/components/work/WorkItemOverlay';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { statsDateLabel, todayDone, totalRemaining } from '@/lib/stats-view';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { StatsActiveList } from '@/components/stats/StatsActiveList';
import { StatsByActor } from '@/components/stats/StatsByActor';
import { StatsEmptyGuide } from '@/components/stats/StatsEmptyGuide';
import { StatsRemainingCard } from '@/components/stats/StatsRemainingCard';
import { StatsTodayCard } from '@/components/stats/StatsTodayCard';
import { StatsTrendChart } from '@/components/stats/StatsTrendChart';
import type { StatsActiveItem, StatsResponse } from '@/lib/stats-types';

const POLL_INTERVAL_MS = 30_000;

/** 统计工作区：严格隔离统计当前选定项目的产出、剩余、经手人与 14 天节奏 */
export default function StatsPage() {
  const store = useVibeHub();
  const overlay = useWorkOverlay();
  const { error: toastError } = useToast();
  const router = useRouter();

  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const projectId = store.currentProject?.id ?? null;

  const noActivity =
    !!data &&
    data.active.length === 0 &&
    data.by_actor.length === 0 &&
    data.trend.every((p) => p.bugs_fixed === 0 && p.tasks_done === 0) &&
    totalRemaining(data.remaining) === 0 &&
    todayDone(data.today) === 0 &&
    data.today.bugs_closed_unfixed === 0;

  const load = useCallback(async () => {
    if (!projectId) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      setData(await api.stats({ projectId }));
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
    setData(null);
    void load();
  }, [load, store.statsRevision]);

  useEffect(() => {
    if (!projectId) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load, projectId]);

  const openActiveItem = (item: StatsActiveItem) => {
    overlay.openItem(item.kind, item.id);
  };

  if (!store.loading && !store.currentProject) {
    return (
      <div className="flex h-full flex-col">
        <WorkspaceHeader title="统计" />
        <div className="vh-empty flex-1">
          <span className="vh-empty-icon"><BarChart3 size={24} /></span>
          <p className="vh-empty-title">还没有项目</p>
          <p className="vh-empty-hint">统计严格按当前项目工作区隔离计算；请先创建项目</p>
          <button
            type="button"
            className="vh-btn h-8 text-xs"
            onClick={() => window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'))}
          >
            <FolderPlus size={14} /> 创建第一个项目
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        title="统计"
        subtitle="仅统计当前项目 · 北京时间自然日"
        actions={
          <button
            type="button"
            className="vh-btn ghost h-8 px-2.5 text-xs"
            onClick={() => void load()}
            title="刷新"
            data-testid="stats-refresh"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
            <span>刷新</span>
          </button>
        }
      />

      <div className="vh-ws-scroll">
        <div className="vh-ws-container">
          {!data && error ? (
            <div className="vh-card">
              <div className="vh-empty">
                <span className="vh-empty-icon">
                  <AlertTriangle size={22} className="text-[var(--warn)]" />
                </span>
                <p className="vh-empty-title">统计暂时取不到</p>
                <p className="vh-empty-hint">{error}</p>
                <button type="button" className="vh-btn h-8 text-xs" onClick={() => void load()}>
                  <RefreshCw size={14} /> 重试
                </button>
              </div>
            </div>
          ) : !data ? (
            <StatsSkeleton />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-12">
                <div className="min-w-0 lg:col-span-7">
                  <StatsTodayCard today={data.today} dateLabel={statsDateLabel(data.scope.today)} />
                </div>
                <div className="min-w-0 lg:col-span-5">
                  <StatsRemainingCard remaining={data.remaining} />
                </div>
              </div>

              {noActivity ? (
                <StatsEmptyGuide onOpenWork={() => router.push('/work/bugs')} onOpenToday={() => router.push('/today')} />
              ) : (
                <>
                  <div className="grid items-start gap-4 lg:grid-cols-12">
                    <div className="min-w-0 lg:col-span-7">
                      <StatsActiveList items={data.active} onOpen={openActiveItem} />
                    </div>
                    <div className="min-w-0 lg:col-span-5">
                      <StatsByActor rows={data.by_actor} />
                    </div>
                  </div>

                  <section className="vh-card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-[var(--text-primary)]">最近 14 天趋势</h2>
                      <span className="text-xs text-[var(--text-tertiary)]">含今天，旧 → 新</span>
                    </div>
                    <div className="mt-4">
                      <StatsTrendChart points={data.trend} />
                    </div>
                  </section>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-4" data-testid="stats-skeleton">
      <div className="grid gap-4 lg:grid-cols-12">
        {[7, 5, 7, 5].map((span, i) => (
          <div key={i} className={`vh-card p-5 ${span === 7 ? 'lg:col-span-7' : 'lg:col-span-5'}`}>
            <div className="vh-skeleton h-4 w-24" />
            <div className="vh-skeleton mt-3 h-8 w-20" />
            <div className="vh-skeleton mt-4 h-14 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
