'use client';

import { useEffect, useState } from 'react';
import { PRIORITY_LABELS, SEVERITY_LABELS, type Bug } from '@/lib/api-types';
import { BUG_STATUS_LABELS } from '@/lib/api-types';
import { BUG_TRANSITIONS, bugReasonKind, bugTransitionLabel, type BugStatus } from '@/lib/bug-flow';
import { HandlingLine } from '@/components/activity/HandlingLine';
import { LabelEditor } from '@/components/tasks/LabelEditor';

/** 保存补丁并返回是否成功（失败由调用方 toast，不向外抛） */
export type SaveBug = (patch: Record<string, unknown>, done?: string) => Promise<boolean>;

const inputCls = 'w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2.5 text-sm outline-none focus:border-[var(--brand)] disabled:opacity-70';
const selectCls = 'h-8 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2 text-xs outline-none disabled:opacity-70';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-[var(--text-tertiary)]">{label}</p>
      {children}
    </div>
  );
}

const REASON_FORM = {
  reopen: { testId: 'bug-reopen-form', placeholder: '重开原因：还能复现的现象、在哪个环境', confirm: '确认重开' },
  fail: { testId: 'bug-reopen-form', placeholder: '验证不通过的原因：哪一步、什么环境还能复现', confirm: '确认打回' },
  close: { testId: 'bug-close-form', placeholder: '关闭原因：重复（写上缺陷号）/ 不修复 / 无法复现', confirm: '确认关闭' },
} as const;

/** 只摆出合法的下一步；重开 / 验证不通过 / 关闭 都在页内写原因（不再用浏览器原生 prompt） */
export function BugStatusActions({ bug, disabled, save }: { bug: Bug; disabled: boolean; save: SaveBug }) {
  const [pending, setPending] = useState<BugStatus | null>(null);
  const [reason, setReason] = useState('');
  const from = bug.status;

  const go = async (to: BugStatus, why?: string) => {
    const kind = bugReasonKind(from, to);
    const extra = !why ? {} : kind === 'close' ? { resolution_notes: why } : { reopen_reason: why };
    const ok = await save({ status: to, ...extra }, `已改为「${BUG_STATUS_LABELS[to]}」`);
    if (ok) {
      setPending(null);
      setReason('');
    }
  };

  if (pending) {
    const kind = bugReasonKind(from, pending);
    const form = REASON_FORM[kind === 'close' ? 'close' : from === 'verifying' ? 'fail' : 'reopen'];
    return (
      <div className="flex w-full flex-wrap items-center gap-2" data-testid={form.testId}>
        <input
          autoFocus
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2.5 text-xs outline-none focus:border-[var(--brand)]"
          placeholder={form.placeholder}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && reason.trim() && void go(pending, reason.trim())}
        />
        <button className="vh-btn h-8 text-xs" disabled={!reason.trim()} onClick={() => void go(pending, reason.trim())}>{form.confirm}</button>
        <button className="vh-btn ghost h-8 text-xs" onClick={() => setPending(null)}>取消</button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="rounded-md bg-[var(--brand-soft)] px-2 py-1 text-xs text-[var(--brand)]" data-testid="bug-status-chip">{BUG_STATUS_LABELS[from]}</span>
      <HandlingLine item={bug} className="mr-1" />
      {!disabled && BUG_TRANSITIONS[from].map((to) => (
        <button
          key={to}
          className={`cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors hover:bg-[var(--bg-elevated)] ${
            to === 'closed' ? 'border-[var(--border-subtle)] text-[var(--text-tertiary)]' : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
          }`}
          onClick={() => (bugReasonKind(from, to) ? setPending(to) : void go(to))}
          data-testid={`bug-to-${to}`}
        >
          {bugTransitionLabel(from, to)}
        </button>
      ))}
    </div>
  );
}

interface MetaProps {
  bug: Bug;
  canEdit: boolean;
  members: { id: string; name: string }[];
  save: SaveBug;
}

/** 严重度、优先级、负责人、截止日期、标签 */
export function BugMetaFields({ bug, canEdit, members, save }: MetaProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Field label="严重度">
        <select className={selectCls} value={bug.severity} disabled={!canEdit} onChange={(e) => void save({ severity: e.target.value })} data-testid="bug-severity-select">
          {(Object.keys(SEVERITY_LABELS) as Bug['severity'][]).map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
        </select>
      </Field>
      <Field label="优先级">
        <select className={selectCls} value={bug.priority} disabled={!canEdit} onChange={(e) => void save({ priority: e.target.value })} data-testid="bug-priority-select">
          {(Object.keys(PRIORITY_LABELS) as Bug['priority'][]).map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </select>
      </Field>
      <Field label="负责人">
        <select className={selectCls} value={bug.assignee_id ?? ''} disabled={!canEdit} onChange={(e) => void save({ assignee_id: e.target.value || null })} data-testid="bug-reassign-select">
          <option value="">未指派</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <Field label="截止日期">
        <input
          type="date"
          className={`${selectCls} w-full`}
          value={bug.due_date?.slice(0, 10) ?? ''}
          disabled={!canEdit}
          onChange={(e) => void save({ due_date: e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : null })}
          data-testid="bug-due-input"
        />
      </Field>
      <div className="col-span-2 sm:col-span-4">
        <Field label="标签">
          <LabelEditor value={bug.labels} suggestions={[]} disabled={!canEdit} onChange={(labels) => void save({ labels })} />
        </Field>
      </div>
    </div>
  );
}

/** 复现步骤 / 期望结果 / 实际结果：改完一起保存 */
export function BugTextFields({ bug, canEdit, save }: { bug: Bug; canEdit: boolean; save: SaveBug }) {
  const initial = { steps_to_reproduce: bug.steps_to_reproduce ?? '', expected_result: bug.expected_result ?? '', actual_result: bug.actual_result ?? '' };
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [bug.steps_to_reproduce, bug.expected_result, bug.actual_result]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => draft[k] !== initial[k]);
  const fields: { key: keyof typeof initial; label: string; rows: number }[] = [
    { key: 'steps_to_reproduce', label: '复现步骤', rows: 3 },
    { key: 'expected_result', label: '期望结果', rows: 2 },
    { key: 'actual_result', label: '实际结果', rows: 2 },
  ];
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <Field key={f.key} label={f.label}>
          <textarea
            className={`${inputCls} py-1.5 leading-relaxed`}
            rows={f.rows}
            value={draft[f.key]}
            disabled={!canEdit}
            placeholder={canEdit ? '未填写' : '—'}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            data-testid={`bug-${f.key}`}
          />
        </Field>
      ))}
      {canEdit && dirty && (
        <div className="flex gap-2">
          <button className="vh-btn h-7 text-xs" onClick={() => void save(draft, '已保存')} data-testid="bug-text-save">保存修改</button>
          <button className="vh-btn ghost h-7 text-xs" onClick={() => setDraft(initial)}>撤销修改</button>
        </div>
      )}
    </div>
  );
}
