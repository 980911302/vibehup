'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Inbox, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useCanEdit } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useVibeHub } from '@/hooks/use-vibehub';
import { BUG_STATUS_LABELS } from '@/lib/api-types';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/lib/task-flow';
import { hasDeliveryEvidence, evidenceSummary } from '@/lib/evidence';
import type { TodayItem } from '@/lib/today-types';
import { TodayVerifyActions } from '@/components/today/TodayVerifyActions';
import { TodayRejectDialog } from '@/components/today/TodayRejectDialog';

/**
 * 工作 · 队列（R90 后续）：默认先看「我的队列 + 待验收」，六列看板降为二级视图。
 * 数据复用 /api/today（跨项目），这里只筛当前项目；动作与今日一致。
 */
export function WorkQueue() {
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = useCanEdit();
  const store = useVibeHub();
  const toast = useToast();
  const [mine, setMine] = useState<TodayItem[]>([]);
  const [verify, setVerify] = useState<TodayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TodayItem | null>(null);
  const project = store.currentProject;

  const load = async () => {
    if (!project) return;
    try {
      const [m, v] = await Promise.all([
        api.getWorkItems(project.id, 'my'),
        api.getWorkItems(project.id, 'verify'),
      ]);
      setMine(m.items);
      setVerify(v.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '队列加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, store.statsRevision]);

  const openItem = (item: TodayItem) => {
    router.push(item.kind === 'bug' ? `/work/bugs?bug=${item.id}` : `/work/tasks?task=${item.id}`);
  };

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

  if (!project) {
    return (
      <div className="vh-empty" style={{ height: '100%' }}>
        <span className="vh-empty-icon"><Inbox size={24} /></span>
        <p className="vh-empty-title">还没有项目</p>
        <p className="vh-empty-hint">先建一个项目，队列里才会出现要处理的活。</p>
      </div>
    );
  }

  const statusLabel = (item: TodayItem) =>
    item.kind === 'bug'
      ? BUG_STATUS_LABELS[item.status as keyof typeof BUG_STATUS_LABELS] ?? item.status
      : TASK_STATUS_LABELS[item.status as TaskStatus] ?? item.status;

  const row = (item: TodayItem) => (
    <div key={`${item.kind}-${item.id}`} className="vh-card px-4 py-3" data-testid="queue-row">
      <div
        role="button"
        tabIndex={0}
        className="flex cursor-pointer items-start gap-2"
        onClick={() => openItem(item)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openItem(item);
          }
        }}
      >
        <span className="mt-0.5 shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs text-[var(--text-tertiary)]">
          {item.kind === 'bug' ? '缺陷' : '任务'} · {statusLabel(item)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="t-caption-1 block truncate text-[var(--text-primary)]">{item.title}</span>
          <span className="t-caption-5 block truncate text-[var(--text-tertiary)]">
            {item.assignee?.name ?? '未指派'} · {item.project.name}
            {item.stale ? ' · 卡住了' : ''}
          </span>
        </span>
        {item.status === 'resolved' || item.status === 'review' || item.status === 'verifying' ? (
          <span className={`t-caption-5 shrink-0 ${hasDeliveryEvidence(item.evidence) ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}`}>
            {hasDeliveryEvidence(item.evidence) ? `证据 ${evidenceSummary(item.evidence).join(' · ')}` : '缺证据'}
          </span>
        ) : null}
      </div>
      {(item.status === 'resolved' || item.status === 'review' || item.status === 'verifying') && (
        <div className="mt-2">
          <TodayVerifyActions
            item={item}
            busy={busyId === item.id}
            canEdit={canEdit}
            onStart={(x) => void changeStatus(x, { status: 'verifying' }, '已接手验证')}
            onApprove={(x) => {
              if (!hasDeliveryEvidence(x.evidence)) {
                toast.error('先补交付证据，再验收');
                openItem(x);
                return;
              }
              void changeStatus(x, { status: x.kind === 'bug' ? 'verified' : 'done' }, '验收通过');
            }}
            onReject={setRejectTarget}
            onNeedsEvidence={openItem}
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[1100px] p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="t-caption-4 text-[var(--text-tertiary)]">工作 · 队列</p>
          <h1 className="t-heading-4 mt-1">我的队列</h1>
          <p className="t-body-3 mt-1 text-[var(--text-secondary)]">
            {project.name} · 先处理等你的事，再验收；完整看板在「缺陷 / 任务」二级页。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="t-caption-4 text-[var(--text-tertiary)]">{user?.name ?? ''}</span>
          <button className="vh-btn ghost h-8 text-xs" onClick={() => void load()}><RefreshCw size={13} /> 刷新</button>
        </div>
      </header>

      {loading && <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" /></div>}
      {error && (
        <div className="vh-card mt-6 flex flex-col items-center gap-2 p-8 text-center">
          <AlertTriangle size={20} className="text-[var(--warn)]" />
          <p className="t-caption-2 text-[var(--text-tertiary)]">{error}</p>
          <button className="vh-btn mt-1" onClick={() => void load()}>重试</button>
        </div>
      )}

      {!loading && (
        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="t-title-3 flex items-center gap-2"><Inbox size={16} /> 待我处理</h2>
              <span className="t-caption-1 text-[var(--text-tertiary)]">{mine.length} 件</span>
            </div>
            <div className="space-y-2">
              {mine.length === 0 && <p className="t-caption-2 rounded-lg border border-dashed border-[var(--border-strong)] px-4 py-8 text-center text-[var(--text-tertiary)]">没有等你处理的活。</p>}
              {mine.map(row)}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="t-title-3 flex items-center gap-2"><ShieldCheck size={16} /> 待验收</h2>
              <span className="t-caption-1 text-[var(--text-tertiary)]">{verify.length} 件</span>
            </div>
            <div className="space-y-2">
              {verify.length === 0 && <p className="t-caption-2 rounded-lg border border-dashed border-[var(--border-strong)] px-4 py-8 text-center text-[var(--text-tertiary)]">没有等你验收的结果。</p>}
              {verify.map(row)}
            </div>
          </section>
        </div>
      )}

      <TodayRejectDialog
        item={rejectTarget}
        busy={rejectTarget ? busyId === rejectTarget.id : false}
        onClose={() => setRejectTarget(null)}
        onConfirm={(reason) => void confirmReject(reason)}
      />
    </div>
  );
}
