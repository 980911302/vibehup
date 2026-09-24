'use client';

import { SEVERITY_LABELS, type Bug } from '@/lib/api-types';
import { WHO_LABELS, type WhoFilter } from '@/lib/bug-filters';

const WHO_OPTIONS: WhoFilter[] = ['all', 'mine', 'reported', 'unassigned'];

/** 人员维度快捷筛选：全部 / 指派给我 / 我提的 / 未指派 */
export function WhoSegment({ value, onChange }: { value: WhoFilter; onChange: (v: WhoFilter) => void }) {
  return (
    <div className="flex gap-1 rounded-lg bg-[var(--bg-elevated)] p-0.5" role="group" aria-label="按人员筛选">
      {WHO_OPTIONS.map((w) => (
        <button
          key={w}
          className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            value === w ? 'bg-[var(--bg-page)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)]'
          }`}
          onClick={() => onChange(w)}
          aria-pressed={value === w}
          data-testid={`board-who-${w}`}
        >
          {WHO_LABELS[w]}
        </button>
      ))}
    </div>
  );
}

interface FilterPanelProps {
  severity?: string;
  label?: string;
  labels: string[];
  onChange: (patch: { severity?: string; label?: string }) => void;
}

/** 展开的筛选面板：严重度 + 标签 */
export function BoardFilterPanel({ severity, label, labels, onChange }: FilterPanelProps) {
  const selectCls = 'h-7 rounded border border-[var(--border-strong)] bg-[var(--bg-page)] px-1';
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-2 text-xs">
      <label className="flex items-center gap-1.5">
        严重度
        <select className={selectCls} value={severity ?? ''} onChange={(e) => onChange({ severity: e.target.value || undefined })}>
          <option value="">全部</option>
          {(Object.keys(SEVERITY_LABELS) as Bug['severity'][]).map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        标签
        <select className={selectCls} value={label ?? ''} onChange={(e) => onChange({ label: e.target.value || undefined })}>
          <option value="">全部</option>
          {labels.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>
    </div>
  );
}
