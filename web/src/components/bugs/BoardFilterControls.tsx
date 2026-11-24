'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Archive, Filter, LayoutGrid, List, Plus, Search, X } from 'lucide-react';
import { SEVERITY_LABELS, type Bug } from '@/lib/api-types';
import { WHO_LABELS, type WhoFilter } from '@/lib/bug-filters';
import { cn } from '@/lib/utils';

const WHO_OPTIONS: WhoFilter[] = ['all', 'mine', 'reported', 'unassigned'];

export function BoardUrlSync({ onOpenBug, onNew }: { onOpenBug: (id: string) => void; onNew: () => void }) {
  const params = useSearchParams();
  const bugId = params.get('bug');
  const isNew = params.get('new');

  const clear = (key: string) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(key)) return;
    url.searchParams.delete(key);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  };

  useEffect(() => {
    if (!bugId) return;
    onOpenBug(bugId);
    clear('bug');
  }, [bugId, onOpenBug]);
  useEffect(() => {
    if (isNew !== '1') return;
    onNew();
    clear('new');
  }, [isNew, onNew]);
  return null;
}

export function WhoSegment({ value, onChange }: { value: WhoFilter; onChange: (v: WhoFilter) => void }) {
  return (
    <div className="vh-segmented" role="group" aria-label="按人员筛选">
      {WHO_OPTIONS.map((w) => (
        <button
          key={w}
          type="button"
          className={cn('!h-7 !px-2.5 !text-xs', value === w && 'active')}
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

export function BoardHeaderActions({
  viewMode,
  showArchived,
  archivedCount,
  canEdit,
  onViewChange,
  onToggleArchived,
  onCreate,
}: {
  viewMode: 'board' | 'list';
  showArchived: boolean;
  archivedCount: number;
  canEdit: boolean;
  onViewChange: (v: 'board' | 'list') => void;
  onToggleArchived: () => void;
  onCreate: () => void;
}) {
  return (
    <>
      <div className="vh-segmented hidden sm:inline-flex" role="group" aria-label="视图切换">
        <button
          type="button"
          className={cn('flex items-center gap-1 !h-7 !px-2.5 !text-xs', viewMode === 'board' && 'active')}
          onClick={() => onViewChange('board')}
          data-testid="bug-view-board"
        >
          <LayoutGrid size={12} /> 看板
        </button>
        <button
          type="button"
          className={cn('flex items-center gap-1 !h-7 !px-2.5 !text-xs', viewMode === 'list' && 'active')}
          onClick={() => onViewChange('list')}
          data-testid="bug-view-list"
        >
          <List size={12} /> 列表
        </button>
      </div>
      <button
        type="button"
        className={cn('vh-btn ghost h-8 px-2.5 text-xs', showArchived && 'border-[var(--brand)] text-[var(--text-primary)]')}
        onClick={onToggleArchived}
        title="切换是否显示已验证与已关闭的缺陷"
        data-testid="bug-toggle-archived"
      >
        <Archive size={13} />
        <span className="hidden md:inline">已结项</span>
        {archivedCount > 0 && <span className="opacity-70">{archivedCount}</span>}
      </button>
      {canEdit && (
        <button type="button" className="vh-btn h-8 px-2.5 text-xs" onClick={onCreate} data-testid="create-bug">
          <Plus size={14} /> 录缺陷
        </button>
      )}
    </>
  );
}

export function BoardToolbar({
  who,
  search,
  activeFilters,
  onWho,
  onSearch,
  onToggleFilter,
  onClear,
}: {
  who: WhoFilter;
  search: string;
  activeFilters: number;
  onWho: (w: WhoFilter) => void;
  onSearch: (q: string) => void;
  onToggleFilter: () => void;
  onClear: () => void;
}) {
  return (
    <div className="vh-ws-toolbar">
      <WhoSegment value={who} onChange={onWho} />
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <input className="vh-input-compact w-44 pl-7" placeholder="搜索缺陷" value={search} onChange={(e) => onSearch(e.target.value)} />
      </div>
      <button type="button" className="vh-btn ghost h-8 px-2.5 text-xs" onClick={onToggleFilter}>
        <Filter size={13} /> 筛选
        {activeFilters > 0 && <span className="rounded-full bg-[var(--brand)] px-1.5 text-[10px] text-white">{activeFilters}</span>}
      </button>
      {activeFilters > 0 && (
        <button type="button" className="vh-btn ghost h-8 px-2 text-xs" onClick={onClear}>
          <X size={13} /> 清除
        </button>
      )}
      <span className="ml-auto hidden text-xs text-[var(--text-tertiary)] md:inline">直接粘贴截图自动打开录入 · 按 C 快速新建</span>
    </div>
  );
}

export function BoardFilterPanel({
  severity,
  label,
  labels,
  onChange,
}: {
  severity?: string;
  label?: string;
  labels: string[];
  onChange: (patch: { severity?: string; label?: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-5 py-2 text-xs">
      <label className="flex items-center gap-1.5">
        严重度
        <select className="vh-input-compact !h-7 px-1.5" value={severity ?? ''} onChange={(e) => onChange({ severity: e.target.value || undefined })}>
          <option value="">全部</option>
          {(Object.keys(SEVERITY_LABELS) as Bug['severity'][]).map((s) => (
            <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        标签
        <select className="vh-input-compact !h-7 px-1.5" value={label ?? ''} onChange={(e) => onChange({ label: e.target.value || undefined })}>
          <option value="">全部</option>
          {labels.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
