'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Pencil, ShieldCheck } from 'lucide-react';
import type { DeliveryEvidence } from '@/lib/api-types';
import { evidenceSummary, hasDeliveryEvidence } from '@/lib/evidence';

const input = 'h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2.5 text-sm outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent-color)]';

/**
 * 交付证据（R90）：AI 通过 MCP 写入，人也在这里补。
 * 只收结构化短字段；截图沿用附件区，不重复造上传。
 */
export function EvidencePanel({
  value,
  canEdit,
  onSave,
}: {
  value: DeliveryEvidence | null;
  canEdit: boolean;
  onSave: (evidence: DeliveryEvidence | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    commit: value?.commit ?? '',
    pr_url: value?.pr_url ?? '',
    tests: value?.tests ?? '',
    notes: value?.notes ?? '',
    no_code_reason: value?.no_code_reason ?? '',
  });

  useEffect(() => {
    setForm({
      commit: value?.commit ?? '',
      pr_url: value?.pr_url ?? '',
      tests: value?.tests ?? '',
      notes: value?.notes ?? '',
      no_code_reason: value?.no_code_reason ?? '',
    });
  }, [value]);

  const complete = hasDeliveryEvidence(value);

  const save = async () => {
    setSaving(true);
    const next: DeliveryEvidence = {};
    for (const [k, v] of Object.entries(form)) if (v.trim()) next[k as keyof DeliveryEvidence] = v.trim() as never;
    // 保留 AI/人已写入但本面板不编辑的字段
    if (value?.changed_files?.length) next.changed_files = value.changed_files;
    if (value?.screenshots?.length) next.screenshots = value.screenshots;
    const ok = await onSave(Object.keys(next).length ? next : null);
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <section className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] p-3" data-testid="evidence-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="t-caption-4 flex items-center gap-1.5 text-[var(--text-secondary)]">
          <ShieldCheck size={14} /> 交付证据
          {complete ? <span className="rounded bg-[var(--ok)]/12 px-1.5 py-0.5 text-xs text-[var(--ok)]">可验收</span> : <span className="rounded bg-[var(--warn)]/12 px-1.5 py-0.5 text-xs text-[var(--warn)]">缺证据</span>}
        </p>
        {canEdit && !editing && (
          <button className="flex items-center gap-1 text-xs text-[var(--accent-color)]" onClick={() => setEditing(true)}>
            <Pencil size={12} /> {value ? '编辑' : '补证据'}
          </button>
        )}
      </div>

      {!editing && (
        <div className="mt-2 space-y-1 text-sm">
          {!value ? (
            <p className="t-caption-2 text-[var(--text-tertiary)]">还没有交付证据。可以等 AI 回填，也可以在这里补 commit / PR / 测试。</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {evidenceSummary(value).map((x) => <span key={x} className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs text-[var(--text-tertiary)]">{x}</span>)}
              </div>
              {value.notes && <p className="t-caption-2 whitespace-pre-wrap text-[var(--text-secondary)]">{value.notes}</p>}
              {value.no_code_reason && <p className="t-caption-2 text-[var(--text-tertiary)]">无需代码：{value.no_code_reason}</p>}
            </>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="t-caption-5 text-[var(--text-tertiary)]">Commit<input className={input} value={form.commit} onChange={(e) => setForm({ ...form, commit: e.target.value })} placeholder="9f2c1ab" /></label>
          <label className="t-caption-5 text-[var(--text-tertiary)]">PR 链接<input className={input} value={form.pr_url} onChange={(e) => setForm({ ...form, pr_url: e.target.value })} placeholder="https://github.com/..." /></label>
          <label className="t-caption-5 sm:col-span-2 text-[var(--text-tertiary)]">测试<input className={input} value={form.tests} onChange={(e) => setForm({ ...form, tests: e.target.value })} placeholder="vitest 348 passed；E2E 14 passed" /></label>
          <label className="t-caption-5 sm:col-span-2 text-[var(--text-tertiary)]">一句话说明<textarea className="min-h-16 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] p-2.5 text-sm outline-none focus:border-[var(--accent-color)]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="改了什么、怎么验的" /></label>
          <label className="t-caption-5 sm:col-span-2 text-[var(--text-tertiary)]">无需代码证据的原因（非代码任务填）<input className={input} value={form.no_code_reason} onChange={(e) => setForm({ ...form, no_code_reason: e.target.value })} placeholder="只改了线上配置 / 只做了设计确认" /></label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button className="vh-btn ghost h-8 text-xs" disabled={saving} onClick={() => setEditing(false)}>取消</button>
            <button className="vh-btn h-8 text-xs" disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 保存证据
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
