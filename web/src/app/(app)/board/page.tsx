'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Filter, FolderPlus, Plus, Search, X } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import { useHotkeys } from '@/lib/shortcuts';
import { BugBoard } from '@/components/bugs/BugBoard';
import { BugDetailDialog } from '@/components/bugs/BugDetailDialog';
import { CreateBugDialog } from '@/components/bugs/CreateBugDialog';
import { TextViewer } from '@/components/assets/TextViewer';
import { BatchBar } from '@/components/bugs/BatchBar';
import { CurrentProjectSwitcher } from '@/components/layout/CurrentProjectSwitcher';
import { BugContextMenu } from '@/components/bugs/BugContextMenu';
import { BoardFilterPanel, WhoSegment } from '@/components/bugs/BoardFilterControls';
import { activeFilterCount, filterBoard, type WhoFilter } from '@/lib/bug-filters';

/** 缺陷看板页（步骤 07 §7.1）：筛选条 + 五列看板 + 批量栏 */
export default function BoardPage() {
  const store = useVibeHub();
  const { user } = useAuth();
  const toast = useToast();

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

  // 快捷键：C 新建 / Esc 清选择（输入态放行由 useHotkeys 处理）
  useHotkeys([
    { combo: 'c', description: '新建缺陷', handler: () => canEdit && setCreateOpen(true) },
    { combo: 'esc', description: '清选择', handler: () => { setSelectedIds([]); setMenu(null); } },
  ]);

  // 全局 Ctrl+V：图片直接进入录入流程
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length || !canEdit) return;
      e.preventDefault();
      setPendingFiles(files);
      setCreateOpen(true);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [canEdit]);

  // 组件卸载清定时器
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

  // 缩略图映射（每缺陷第一张图片附件）
  const thumbnails = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of store.attachments) {
      if (a.entity_type === 'bug' && a.entity_id && a.file_type.startsWith('image/') && !map[a.entity_id]) {
        map[a.entity_id] = a.public_url ?? '';
      }
    }
    return map;
  }, [store.attachments]);

  // 筛选 + 搜索（人员维度：指派给我 / 我提的 / 未指派）
  const boardFilters = { who, ...filters, search };
  const filteredBoard = useMemo(
    () => filterBoard(store.board, { who, ...filters, search }, user?.id ?? null),
    [store.board, who, filters, search, user?.id],
  );

  const allLabels = useMemo(() => {
    const s = new Set<string>();
    Object.values(store.board).flat().forEach((b) => b.labels.forEach((l: string) => s.add(l)));
    return [...s];
  }, [store.board]);

  // 空态：无项目（四要素：图标 + 人话 + 主按钮 + 快捷键提示；按钮唤起首启向导）
  if (!store.loading && !store.currentProject) {
    return (
      <div className="vh-empty" style={{ height: '100%' }}>
        <span className="vh-empty-icon"><ClipboardList size={28} strokeWidth={1.6} /></span>
        <p className="vh-empty-title">还没有项目</p>
        <p className="vh-empty-hint">项目是缺陷与上下文的容器，AI 靠项目标识匹配你的仓库</p>
        <button
          className="vh-btn"
          onClick={() => window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'))}
          data-testid="board-empty-create"
        >
          <FolderPlus size={14} />
          创建第一个项目
        </button>
        <p className="vh-empty-hint">
          或按 <span className="vh-kbd">G</span> <span className="vh-kbd">N</span> 去随手记先记点什么
        </p>
      </div>
    );
  }

  const activeFilters = activeFilterCount(boardFilters);

  return (
    <div className="flex h-full flex-col">
      {/* 筛选条 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
        <CurrentProjectSwitcher />
        <WhoSegment value={who} onChange={setWho} />

        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            className="h-8 w-44 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] pl-7 pr-2 text-xs outline-none focus:border-[var(--brand)]"
            placeholder="搜索缺陷"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <button className="vh-btn ghost h-8 text-xs" onClick={() => setFilterOpen((v) => !v)}>
          <Filter size={13} />
          筛选{activeFilters > 0 && <span className="ml-1 rounded-full bg-[var(--brand)] px-1.5 text-[10px] text-white">{activeFilters}</span>}
        </button>

        {/* 移动端录缺陷入口（卡片 38：触屏无 C 快捷键，<900px 常驻按钮） */}
        {canEdit && (
          <button
            className="vh-btn hidden h-8 text-xs max-[899px]:inline-flex"
            onClick={() => setCreateOpen(true)}
            data-testid="mobile-create-bug"
          >
            <Plus size={14} />
            录缺陷
          </button>
        )}

        {activeFilters > 0 && (
          <button className="vh-btn ghost h-8 text-xs" onClick={() => { setFilters({}); setSearch(''); setWho('all'); }}>
            <X size={13} />
            清除
          </button>
        )}

        <div className="flex-1" />

        <span className="text-xs text-[var(--text-tertiary)]">
          {store.currentProject?.name} · {Object.values(store.board).flat().length} 个缺陷
        </span>
      </div>

      {filterOpen && (
        <BoardFilterPanel
          severity={filters.severity}
          label={filters.label}
          labels={allLabels}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        />
      )}

      {/* 看板 */}
      <div className="flex-1 overflow-hidden p-4">
        <BugBoard
          board={filteredBoard}
          thumbnails={thumbnails}
          flashIds={flashIds}
          canEdit={canEdit}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onMoveBug={(bugId, status) => {
            // 服务端仍可能拒绝（比如别人刚改过状态）：人话提示，不再抛未捕获异常（功能巡检 B4）
            store.moveBug(bugId, status).then(
              () => flash(bugId),
              (e) => toast.error(e instanceof Error ? e.message : '状态修改失败'),
            );
          }}
          onOpenBug={(bugId) => setDetailId(bugId)}
          onContextMenu={(bugId, e) => {
            e.preventDefault();
            setMenu({ bugId, x: e.clientX, y: e.clientY });
          }}
        />
      </div>

      {/* 批量栏 */}
      {selectedIds.length > 0 && (
        <BatchBar
          count={selectedIds.length}
          canEdit={canEdit}
          onClear={() => setSelectedIds([])}
          onAction={async (action, payload) => {
            const result = await store.batchBugs(selectedIds, action, payload);
            if (result.skipped.length > 0) {
              toast.error(`${result.skipped.length} 项失败：${result.skipped[0].reason}`);
            }
            if (result.updated > 0) toast.success(`已更新 ${result.updated} 项`);
            setSelectedIds([]);
          }}
        />
      )}

      {/* 右键菜单（删除二次确认） */}
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
          onOpen={() => {
            setDetailId(menu.bugId);
            setMenu(null);
          }}
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

      {detailId && (
        <BugDetailDialog
          bugId={detailId}
          canEdit={canEdit}
          onClose={() => setDetailId(null)}
          onChanged={() => void store.refreshBoard()}
          onOpenText={(id, name) => setTextViewer({ id, name })}
        />
      )}

      {textViewer && (
        <TextViewer
          attachmentId={textViewer.id}
          fileName={textViewer.name}
          onClose={() => setTextViewer(null)}
        />
      )}
    </div>
  );
}
