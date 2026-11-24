'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ClipboardList, FolderPlus } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useHotkeys } from '@/lib/shortcuts';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { BugBoard } from '@/components/bugs/BugBoard';
import { BugListView } from '@/components/bugs/BugListView';
import { BugDetailDialog } from '@/components/bugs/BugDetailDialog';
import { CreateBugDialog } from '@/components/bugs/CreateBugDialog';
import { TextViewer } from '@/components/assets/TextViewer';
import { BatchBar } from '@/components/bugs/BatchBar';
import { BugContextMenu } from '@/components/bugs/BugContextMenu';
import { BoardFilterPanel, BoardHeaderActions, BoardToolbar, BoardUrlSync } from '@/components/bugs/BoardFilterControls';
import { activeFilterCount, filterBoard, type WhoFilter } from '@/lib/bug-filters';
import { BUG_STATUS_LABELS, type Bug } from '@/lib/api-types';
import { BUG_STATUSES } from '@/lib/bug-flow';
import { cn } from '@/lib/utils';

/** 缺陷工作区：统一顶栏 + 看板/列表双视图切换 + 已归档显隐开关 + 单一主操作按钮 */
export default function BoardPage() {
  const store = useVibeHub();
  const pathname = usePathname();
  const { user } = useAuth();
  const toast = useToast();

  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [showArchived, setShowArchived] = useState(!pathname.startsWith('/work'));
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [textViewer, setTextViewer] = useState<{ id: string; name: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ bugId: string; x: number; y: number } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<{ severity?: string; label?: string }>({});
  const [who, setWho] = useState<WhoFilter>('all');
  const [search, setSearch] = useState('');
  const flashTimers = useRef<Map<string, number>>(new Map());

  const canEdit = user?.role !== 'viewer';
  const openCreate = useCallback(() => canEdit && setCreateOpen(true), [canEdit]);

  useEffect(() => setShowArchived(!pathname.startsWith('/work')), [pathname]);

  useEffect(() => {
    setSelectedIds([]);
    setDetailId(null);
    setMenu(null);
  }, [store.currentProject?.id]);

  useHotkeys([{ combo: 'esc', description: '清选择', handler: () => { setSelectedIds([]); setMenu(null); } }]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length || !canEdit) return;
      if ((e.target as HTMLElement | null)?.closest('[role="dialog"], [data-testid="bug-paste-area"]')) return;
      e.preventDefault();
      setPendingFiles(files);
      setCreateOpen(true);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [canEdit]);

  useEffect(() => {
    const timers = flashTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  const flash = (bugId: string) => {
    setFlashIds((prev) => new Set(prev).add(bugId));
    const timer = window.setTimeout(() => {
      setFlashIds((prev) => {
        const next = new Set(prev);
        next.delete(bugId);
        return next;
      });
      flashTimers.current.delete(bugId);
    }, 1200);
    flashTimers.current.set(bugId, timer);
  };

  const thumbnails = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of store.attachments) {
      if (a.entity_type === 'bug' && a.entity_id && a.file_type.startsWith('image/') && !map[a.entity_id]) {
        map[a.entity_id] = a.public_url ?? '';
      }
    }
    return map;
  }, [store.attachments]);

  const filteredBoard = useMemo(
    () => filterBoard(store.board, { who, ...filters, search }, user?.id ?? null),
    [store.board, who, filters, search, user?.id],
  );

  const allLabels = useMemo(() => {
    const s = new Set<string>();
    Object.values(store.board).flat().forEach((b) => b.labels.forEach((l: string) => s.add(l)));
    return [...s];
  }, [store.board]);

  if (!store.loading && !store.currentProject) {
    return (
      <div className="flex h-full flex-col">
        <WorkspaceHeader title="缺陷" />
        <div className="vh-empty flex-1">
          <span className="vh-empty-icon"><ClipboardList size={24} strokeWidth={1.6} /></span>
          <p className="vh-empty-title">还没有项目</p>
          <p className="vh-empty-hint">项目是缺陷与上下文的隔离工作区，AI 靠项目 slug 匹配代码仓库</p>
          <button
            type="button"
            className="vh-btn h-8 text-xs"
            onClick={() => window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'))}
            data-testid="board-empty-create"
          >
            <FolderPlus size={14} /> 创建第一个项目
          </button>
        </div>
      </div>
    );
  }

  const hideTerminal = !showArchived;
  const activeFilters = activeFilterCount({ who, ...filters, search });
  const totalCount = Object.values(store.board).flat().length;
  const archivedCount = store.board.verified.length + store.board.closed.length;
  const mobileStatuses = hideTerminal ? BUG_STATUSES.filter((s) => s !== 'verified' && s !== 'closed') : BUG_STATUSES;
  const mobileBugs = mobileStatuses.flatMap((status) => (filteredBoard[status] ?? []).map((bug: Bug) => ({ bug, status })));

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        title="缺陷"
        badge={totalCount}
        actions={
          <BoardHeaderActions
            viewMode={viewMode}
            showArchived={showArchived}
            archivedCount={archivedCount}
            canEdit={canEdit}
            onViewChange={setViewMode}
            onToggleArchived={() => setShowArchived((v) => !v)}
            onCreate={() => setCreateOpen(true)}
          />
        }
      />

      <BoardToolbar
        who={who}
        search={search}
        activeFilters={activeFilters}
        onWho={setWho}
        onSearch={setSearch}
        onToggleFilter={() => setFilterOpen((v) => !v)}
        onClear={() => { setFilters({}); setSearch(''); setWho('all'); }}
      />

      {filterOpen && (
        <BoardFilterPanel
          severity={filters.severity}
          label={filters.label}
          labels={allLabels}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        />
      )}

      <div className={cn('flex-1 min-h-0', viewMode === 'board' ? 'overflow-hidden p-4' : 'overflow-y-auto p-5')}>
        {viewMode === 'list' ? (
          <div className="vh-ws-container">
            <BugListView
              board={filteredBoard}
              hideTerminal={hideTerminal}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onOpenBug={setDetailId}
              onContextMenu={(bugId, e) => { e.preventDefault(); setMenu({ bugId, x: e.clientX, y: e.clientY }); }}
            />
          </div>
        ) : (
          <>
            <div className="hidden h-full md:block">
              <BugBoard
                board={filteredBoard}
                thumbnails={thumbnails}
                flashIds={flashIds}
                canEdit={canEdit}
                selectedIds={selectedIds}
                hideTerminal={hideTerminal}
                onSelectionChange={setSelectedIds}
                onMoveBug={(bugId, status) => {
                  store.moveBug(bugId, status).then(
                    () => flash(bugId),
                    (e) => toast.error(e instanceof Error ? e.message : '状态修改失败'),
                  );
                }}
                onOpenBug={setDetailId}
                onContextMenu={(bugId, e) => { e.preventDefault(); setMenu({ bugId, x: e.clientX, y: e.clientY }); }}
              />
            </div>

            <div className="h-full space-y-2 overflow-y-auto md:hidden">
              {mobileBugs.length === 0 && <p className="py-10 text-center text-xs text-[var(--text-tertiary)]">当前筛选下没有缺陷。</p>}
              {mobileBugs.map(({ bug, status }) => (
                <button key={bug.id} type="button" className="vh-card w-full p-3 text-left" onClick={() => setDetailId(bug.id)}>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs text-[var(--text-tertiary)]">{BUG_STATUS_LABELS[status]}</span>
                    <span className="text-xs text-[var(--text-tertiary)]">{bug.priority}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm font-medium text-[var(--text-primary)]">{bug.title}</p>
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">{bug.assignee?.name ?? '未指派'}</p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {selectedIds.length > 0 && (
        <BatchBar
          count={selectedIds.length}
          canEdit={canEdit}
          onClear={() => setSelectedIds([])}
          onAction={async (action, payload) => {
            const result = await store.batchBugs(selectedIds, action, payload);
            if (result.skipped.length > 0) toast.error(`${result.skipped.length} 项失败：${result.skipped[0].reason}`);
            if (result.updated > 0) toast.success(`已更新 ${result.updated} 项`);
            setSelectedIds([]);
          }}
        />
      )}

      {menu && (
        <BugContextMenu
          x={menu.x}
          y={menu.y}
          canDelete={canEdit}
          onClose={() => setMenu(null)}
          onCopy={() => {
            const bug = Object.values(store.board).flat().find((b) => b.id === menu.bugId);
            if (bug) void navigator.clipboard.writeText(bug.title);
            setMenu(null);
          }}
          onOpen={() => { setDetailId(menu.bugId); setMenu(null); }}
          onDelete={() => {
            const id = menu.bugId;
            setMenu(null);
            store.deleteBug(id).then(
              () => toast.success('已删除 1 个缺陷'),
              (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
            );
          }}
        />
      )}

      <CreateBugDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectName={store.currentProject?.name ?? null}
        templates={store.templates}
        pendingFiles={pendingFiles}
        onConsumePendingFiles={() => setPendingFiles([])}
        onSubmit={store.createBug}
        projectId={store.currentProject?.id ?? ''}
      />

      <Suspense fallback={null}>
        <BoardUrlSync onOpenBug={setDetailId} onNew={openCreate} />
      </Suspense>

      {detailId && (
        <BugDetailDialog
          bugId={detailId}
          canEdit={canEdit}
          onClose={() => setDetailId(null)}
          onChanged={() => store.notifyWorkChanged()}
          onOpenText={(id, name) => setTextViewer({ id, name })}
        />
      )}

      {textViewer && <TextViewer attachmentId={textViewer.id} fileName={textViewer.name} onClose={() => setTextViewer(null)} />}
    </div>
  );
}
