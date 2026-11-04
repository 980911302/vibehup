'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Inbox,
  RefreshCw,
  Sparkles,
  Sunrise,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useCanEdit } from '@/lib/auth';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useMinuteClock } from '@/hooks/use-minute-clock';
import { useToast } from '@/lib/toast';
import type { TodayItem, TodayResponse } from '@/lib/today-types';
import { CreateBugDialog } from '@/components/bugs/CreateBugDialog';
import { StatsTrendChart } from '@/components/stats/StatsTrendChart';
import { ActionCard, ActiveRow, Metric, TodaySkeleton, dateLabel, greeting } from '@/components/today/TodayWidgets';
import { TodayVerifyActions } from '@/components/today/TodayVerifyActions';
import { TodayRejectDialog } from '@/components/today/TodayRejectDialog';
import { hasDeliveryEvidence } from '@/lib/evidence';

const POLL_MS = 30_000;

export default function TodayPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = useCanEdit();
  const store = useVibeHub();
  const toast = useToast();
  const now = useMinuteClock();

  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TodayItem | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getToday());
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : '今日数据加载失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, store.statsRevision]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const onCreated = () => void load();
    window.addEventListener('vibehub:record-created', onCreated);
    return () => window.removeEventListener('vibehub:record-created', onCreated);
  }, [load]);

  const openItem = useCallback(
    (item: TodayItem) => {
      if (item.project.id !== store.currentProject?.id) store.selectProject(item.project.id);
      router.push(item.kind === 'bug' ? `/work/bugs?bug=${item.id}` : `/work/tasks?task=${item.id}`);
    },
    [router, store],
  );

  const changeStatus = async (item: TodayItem, patch: Record<string, unknown>, success: string) => {
    setBusyId(item.id);
    try {
      if (item.kind === 'bug') await api.updateBug(item.id, patch);
      else await api.updateTask(item.id, patch);
      await load();
      toast.success(success);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '状态更新失败');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const startVerify = (item: TodayItem) => {
    void changeStatus(item, { status: 'verifying' }, '已接手验证');
  };
  const approve = (item: TodayItem) => {
    if (!hasDeliveryEvidence(item.evidence)) {
      toast.error('先补交付证据，再验收');
      openItem(item);
      return;
    }
    void changeStatus(item, { status: item.kind === 'bug' ? 'verified' : 'done' }, '验收通过');
  };
  const confirmReject = async (reason: string) => {
    if (!rejectTarget) return;
    const item = rejectTarget;
    const ok = await changeStatus(
      item,
      { status: item.kind === 'bug' ? 'in_progress' : 'doing', reopen_reason: reason },
      '已打回',
    );
    if (ok) setRejectTarget(null);
  };

  const counts = useMemo(() => {
    if (!data) return { mine: 0, verify: 0, ai: 0 };
    return { mine: data.needs_me.length, verify: data.to_verify.length, ai: data.ai_active.length };
  }, [data]);

  if (loading && !data) return <TodaySkeleton />;

  if (error && !data) {
    return (
      <div className="vh-page">
        <div className="vh-card flex flex-col items-center gap-3 p-10 text-center">
          <AlertTriangle size={24} className="text-[var(--warn)]" />
          <p className="t-title-3">今日数据暂时取不到</p>
          <p className="t-caption-2 max-w-md text-[var(--text-tertiary)]">{error}</p>
          <button className="vh-btn mt-2" onClick={() => void load()}>
            <RefreshCw size={15} /> 重试
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const noProject = data.projects.length === 0;
  const nothingToday =
    data.needs_me.length === 0 && data.to_verify.length === 0 && data.ai_active.length === 0 && data.active.length === 0;

  return (
    <div className="vh-page">
      {/* 页头 */}
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="t-caption-4 flex items-center gap-2 text-[var(--text-tertiary)]">
            <CalendarDays size={14} />
            {dateLabel(data.date)}
          </p>
          <h1 className="t-heading-3 mt-2 max-w-[680px] text-[var(--text-primary)]">
            {greeting(new Date().getHours())}，{user?.name ?? '你好'}
          </h1>
          <p className="t-body-3 mt-2 max-w-[680px] text-[var(--text-secondary)]">
            先处理等你的事，再看 AI 在干什么。今天需要你动手的，都在这里。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="vh-btn ghost" onClick={() => void load()} aria-label="刷新今日">
            <RefreshCw size={15} className={loading ? 'animate-spin' : undefined} />
            <span className="hidden sm:inline">刷新</span>
          </button>
          <button className="vh-btn" onClick={() => router.push('/stats')}>
            完整统计 <ArrowRight size={15} />
          </button>
        </div>
      </header>

      {noProject ? (
        <div className="vh-card mt-10">
          <div className="vh-empty">
            <span className="vh-empty-icon">
              <Inbox size={22} />
            </span>
            <p className="vh-empty-title">先建一个项目</p>
            <p className="vh-empty-hint">项目是缺陷、任务与上下文的容器；AI 靠项目标识匹配你的仓库。</p>
            <button
              className="vh-btn"
              onClick={() => window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'))}
              data-testid="today-empty-create"
            >
              创建第一个项目
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 行动三块 */}
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            <ActionCard
              label="待我处理"
              hint="指派给你、还没收尾的活"
              count={counts.mine}
              icon={Inbox}
              items={data.needs_me}
              now={now}
              onOpen={openItem}
              empty="没有等你处理的活"
              testId="today-needs-me"
            />
            <ActionCard
              label="待验收"
              hint="AI 或同事交了结果"
              count={counts.verify}
              icon={CheckCircle2}
              items={data.to_verify}
              now={now}
              onOpen={openItem}
              empty="没有等你验收的结果"
              testId="today-to-verify"
              actionsFor={(item) => (
                <TodayVerifyActions
                  item={item}
                  busy={busyId === item.id}
                  canEdit={canEdit}
                  onStart={startVerify}
                  onApprove={approve}
                  onReject={setRejectTarget}
                  onNeedsEvidence={openItem}
                />
              )}
            />
            <ActionCard
              label="AI 进行中"
              hint="Agent 正在接手，卡住会标黄"
              count={counts.ai}
              icon={Sparkles}
              items={data.ai_active}
              now={now}
              onOpen={openItem}
              empty="AI 现在没有在跑"
              testId="today-ai-active"
            />
          </div>

          {nothingToday && (
            <div className="vh-card mt-4 p-8 text-center">
              <CircleDot size={22} className="mx-auto text-[var(--ok)]" />
              <p className="t-title-3 mt-3">今天很干净</p>
              <p className="t-caption-2 mt-1 text-[var(--text-tertiary)]">
                没有待办、待验收或进行中的活。可以从录一个缺陷或记一条上下文开始。
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {canEdit && (
                  <button className="vh-btn" onClick={() => setCreateOpen(true)}>
                    <Sunrise size={15} /> 录一个缺陷
                  </button>
                )}
                <button className="vh-btn ghost" onClick={() => router.push('/context/notes')}>
                  记一条上下文
                </button>
              </div>
            </div>
          )}

          <div className="mt-6 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            {/* 正在干 */}
            <section className="vh-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-5 py-4">
                <div>
                  <h2 className="t-title-3">正在干</h2>
                  <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">按停留时间排序；卡住的会标出来</p>
                </div>
                <button className="vh-btn ghost h-8" onClick={() => router.push('/work')}>
                  全部工作 <ArrowRight size={14} />
                </button>
              </div>
              {data.active.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="t-caption-2 text-[var(--text-tertiary)]">现在没有人或 AI 在处理中的活。</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {data.active.slice(0, 8).map((item) => (
                    <ActiveRow key={`${item.kind}-${item.id}`} item={item} now={now} onOpen={openItem} />
                  ))}
                </div>
              )}
            </section>

            {/* 今天 + 趋势 */}
            <section className="vh-card p-6">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="t-title-3">今天</h2>
                  <p className="t-caption-5 mt-1 text-[var(--text-tertiary)]">按北京时间自然日</p>
                </div>
                <span className="t-caption-4 text-[var(--text-tertiary)]">还剩 {data.remaining.bugs.unresolved + data.remaining.bugs.unverified + data.remaining.tasks.todo + data.remaining.tasks.doing + data.remaining.tasks.unverified} 件</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Metric label="修复" value={data.today.bugs_fixed} suffix="缺陷" />
                <Metric label="完成" value={data.today.tasks_done} suffix="任务" />
                <Metric label="新增" value={data.today.bugs_created + data.today.tasks_created} suffix="条目" />
              </div>
              <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
                <p className="t-caption-4 mb-2 text-[var(--text-tertiary)]">最近 14 天</p>
                <StatsTrendChart points={data.trend} />
              </div>
            </section>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="t-caption-5 text-[var(--text-tertiary)]">
              {data.projects.length} 个进行中的项目 · 每 30 秒自动刷新
            </p>
            {canEdit && (
              <button className="vh-btn" onClick={() => setCreateOpen(true)}>
                <Sunrise size={15} /> 录一个缺陷
              </button>
            )}
          </div>
        </>
      )}

      <TodayRejectDialog
        item={rejectTarget}
        busy={rejectTarget ? busyId === rejectTarget.id : false}
        onClose={() => setRejectTarget(null)}
        onConfirm={(reason) => void confirmReject(reason)}
      />

      {store.currentProject && (
        <CreateBugDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          projectName={store.currentProject.name}
          templates={store.templates}
          pendingFiles={[]}
          onConsumePendingFiles={() => undefined}
          onSubmit={async (input) => {
            const bug = await store.createBug(input);
            await load();
            toast.success('已记录，去工作里看进度');
            return bug;
          }}
          projectId={store.currentProject.id}
        />
      )}
    </div>
  );
}
