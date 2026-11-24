'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bug,
  CheckCircle2,
  FolderPlus,
  Inbox,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useCanEdit } from '@/lib/auth';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useWorkOverlay } from '@/components/work/WorkItemOverlay';
import { useMinuteClock } from '@/hooks/use-minute-clock';
import { useToast } from '@/lib/toast';
import type { TodayItem, TodayResponse } from '@/lib/today-types';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { StatsTrendChart } from '@/components/stats/StatsTrendChart';
import { ActionSection, ActiveRow, KpiTile, TodaySkeleton, dateLabel } from '@/components/today/TodayWidgets';
import { TodayVerifyActions } from '@/components/today/TodayVerifyActions';
import { TodayRejectDialog } from '@/components/today/TodayRejectDialog';
import { hasDeliveryEvidence } from '@/lib/evidence';

const POLL_MS = 30_000;

export default function TodayPage() {
  const router = useRouter();
  const canEdit = useCanEdit();
  const store = useVibeHub();
  const overlay = useWorkOverlay();
  const toast = useToast();
  const now = useMinuteClock();

  const projectId = store.currentProject?.id ?? null;
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TodayItem | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await api.getToday(projectId);
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '概览数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // 切换项目立即清空上一个项目数据并重新拉取
  useEffect(() => {
    setData(null);
    void load();
  }, [load, store.statsRevision]);

  useEffect(() => {
    if (!projectId) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load, projectId]);

  useEffect(() => {
    const onCreated = () => void load();
    window.addEventListener('vibehub:record-created', onCreated);
    return () => window.removeEventListener('vibehub:record-created', onCreated);
  }, [load]);

  const openItem = useCallback(
    (item: TodayItem) => {
      overlay.openItem(item.kind, item.id);
    },
    [overlay],
  );

  const changeStatus = async (item: TodayItem, patch: Record<string, unknown>, success: string) => {
    setBusyId(item.id);
    try {
      if (item.kind === 'bug') await api.updateBug(item.id, patch);
      else await api.updateTask(item.id, patch);
      store.notifyWorkChanged();
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

  const approve = (item: TodayItem) => {
    if (!hasDeliveryEvidence(item.evidence)) {
      toast.error('请先补充交付证据，再执行验收');
      openItem(item);
      return;
    }
    void changeStatus(item, { status: item.kind === 'bug' ? 'verified' : 'done' }, '已验收通过');
  };

  const confirmReject = async (reason: string) => {
    if (!rejectTarget) return;
    const ok = await changeStatus(
      rejectTarget,
      { status: rejectTarget.kind === 'bug' ? 'in_progress' : 'doing', reopen_reason: reason },
      '已打回处理',
    );
    if (ok) setRejectTarget(null);
  };

  if (!store.loading && !store.currentProject) {
    return (
      <div className="flex h-full flex-col">
        <WorkspaceHeader title="项目概览" />
        <div className="vh-empty flex-1">
          <span className="vh-empty-icon"><Inbox size={24} /></span>
          <p className="vh-empty-title">先创建第一个项目工作区</p>
          <p className="vh-empty-hint">每个项目拥有完全隔离的缺陷、任务、上下文与统计空间；AI 通过项目 slug 对齐代码仓库。</p>
          <button type="button" className="vh-btn h-8 text-xs" onClick={() => window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'))} data-testid="today-empty-create">
            <FolderPlus size={14} /> 创建第一个项目
          </button>
        </div>
      </div>
    );
  }

  const remainingTotal = data
    ? data.remaining.bugs.unresolved + data.remaining.bugs.unverified + data.remaining.tasks.todo + data.remaining.tasks.doing + data.remaining.tasks.unverified
    : 0;

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        title="项目概览"
        subtitle={data ? dateLabel(data.date) : undefined}
        actions={
          <>
            <button type="button" className="vh-btn ghost h-8 px-2.5 text-xs" onClick={() => void load()} aria-label="刷新概览">
              <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
              <span className="hidden sm:inline">刷新</span>
            </button>
            {canEdit && (
              <>
                <button type="button" className="vh-btn ghost h-8 px-2.5 text-xs" onClick={overlay.openCreateTask}>
                  <ListChecks size={13} /><span className="hidden sm:inline">建任务</span>
                </button>
                <button type="button" className="vh-btn h-8 px-2.5 text-xs" onClick={overlay.openCreateBug}>
                  <Bug size={13} /> 录缺陷
                </button>
              </>
            )}
          </>
        }
      />

      {loading && !data ? (
        <TodaySkeleton />
      ) : error && !data ? (
        <div className="vh-ws-scroll">
          <div className="vh-card mx-auto flex max-w-md flex-col items-center gap-2 p-8 text-center">
            <AlertTriangle size={20} className="text-[var(--warn)]" />
            <p className="text-sm font-medium">概览数据暂时无法读取</p>
            <p className="text-xs text-[var(--text-tertiary)]">{error}</p>
            <button type="button" className="vh-btn mt-2 h-8 text-xs" onClick={() => void load()}><RefreshCw size={13} /> 重试</button>
          </div>
        </div>
      ) : data ? (
        <div className="vh-ws-scroll">
          <div className="vh-ws-container space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile label="待验收" value={data.to_verify.length} sub="AI 或成员已交结果，等你拍板" icon={ShieldCheck} accent={data.to_verify.length > 0 ? 'warn' : undefined} />
              <KpiTile label="待我处理" value={data.needs_me.length} sub="当前项目指派给你的未结项" icon={Inbox} />
              <KpiTile label="AI 推进中" value={data.ai_active.length} sub="Agent 正在经手的缺陷与任务" icon={Sparkles} accent={data.ai_active.length > 0 ? 'gold' : undefined} />
              <KpiTile label="今日完成 / 剩余" value={`${data.today.bugs_fixed + data.today.tasks_done} / ${remainingTotal}`} sub={`修复 ${data.today.bugs_fixed} 缺陷 · 完成 ${data.today.tasks_done} 任务`} icon={CheckCircle2} accent="ok" />
            </div>

            {/* 主双栏行动工作台 */}
            <div className="grid items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
              <div className="space-y-4">
                <ActionSection
                  title="待验收"
                  hint="核对交付证据后直接通过或打回"
                  count={data.to_verify.length}
                  icon={ShieldCheck}
                  items={data.to_verify}
                  now={now}
                  onOpen={openItem}
                  empty="当前项目没有待验收的缺陷或任务"
                  testId="today-to-verify"
                  actionsFor={(item) => (
                    <TodayVerifyActions
                      item={item}
                      busy={busyId === item.id}
                      canEdit={canEdit}
                      onStart={(x) => void changeStatus(x, { status: 'verifying' }, '已接手验证')}
                      onApprove={approve}
                      onReject={setRejectTarget}
                      onNeedsEvidence={openItem}
                    />
                  )}
                />

                <ActionSection
                  title="待我处理"
                  hint="点击任意条目原地查看与流转"
                  count={data.needs_me.length}
                  icon={Inbox}
                  items={data.needs_me}
                  now={now}
                  onOpen={openItem}
                  empty="当前项目没有指派给你的待办"
                  testId="today-needs-me"
                />
              </div>

              <div className="space-y-4">
                <section className="vh-list-surface" data-testid="today-ai-active">
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Sparkles size={14} className="text-[var(--gold)]" />
                      <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">正在推进</h2>
                      <span className="text-xs text-[var(--text-tertiary)]">超时自动标红提醒</span>
                    </div>
                    <button
                      type="button"
                      className="flex cursor-pointer items-center gap-1 text-xs text-[var(--brand)] hover:underline"
                      onClick={() => router.push('/work/bugs')}
                    >
                      去缺陷看板 <ArrowRight size={12} />
                    </button>
                  </div>
                  {data.active.length === 0 ? (
                    <p className="px-4 py-6 text-center text-xs text-[var(--text-tertiary)]">
                      当前项目暂无处理中的缺陷或任务
                    </p>
                  ) : (
                    <div>
                      {data.active.slice(0, 10).map((item) => (
                        <ActiveRow key={`${item.kind}-${item.id}`} item={item} now={now} onOpen={openItem} />
                      ))}
                    </div>
                  )}
                </section>

                <section className="vh-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <BarChart3 size={14} className="text-[var(--text-secondary)]" />
                      <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">本项目 14 天节奏</h2>
                    </div>
                    <button
                      type="button"
                      className="flex cursor-pointer items-center gap-1 text-xs text-[var(--brand)] hover:underline"
                      onClick={() => router.push('/stats')}
                    >
                      详细统计 <ArrowRight size={12} />
                    </button>
                  </div>
                  <StatsTrendChart points={data.trend} />
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <TodayRejectDialog
        item={rejectTarget}
        busy={rejectTarget ? busyId === rejectTarget.id : false}
        onClose={() => setRejectTarget(null)}
        onConfirm={(reason) => void confirmReject(reason)}
      />
    </div>
  );
}
