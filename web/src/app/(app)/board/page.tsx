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
import type { Bug } from '@/lib/api-types';

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
  const [search, setSearch] = useState('');
  const flashTimers = useRef<Map<string, number>>(new Map());

  const canEdit = user?.role !== 'viewer';

  // 快捷键：C 新建 / Esc 清选择（输入态放行由 useHotkeys 处理）
  useHotkeys([
    { combo: 'c', description: '新建缺陷', handler: () => setCreateOpen(true) },
    { combo: 'esc', description: '清选择', handler: () => { setSelectedIds([]); setMenu(null); } },
  ]);

  // 全局 Ctrl+V：图片直接进入录入流程
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      setPendingFiles(files);
      setCreateOpen(true);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

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

  // 筛选 + 搜索
  const filteredBoard = useMemo(() => {
    const apply = (bugs: Bug[]) =>
      bugs.filter((b) => {
        if (filters.severity && b.severity !== filters.severity) return false;
        if (filters.label && !b.labels.includes(filters.label)) return false;
        if (search.trim() && !`${b.title} ${b.labels.join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
        return true;
      });
    return {
      open: apply(store.board.open),
      in_progress: apply(store.board.in_progress),
      resolved: apply(store.board.resolved),
      verified: apply(store.board.verified),
      closed: apply(store.board.closed),
    };
  }, [store.board, filters, search]);

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

  const activeFilters = Object.entries(filters).filter(([, v]) => v).length + (search.trim() ? 1 : 0);

  return (
    <div className="flex h-full flex-col">
      {/* 筛选条 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
        <CurrentProjectSwitcher />

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
        <button
          className="vh-btn hidden h-8 text-xs max-[899px]:inline-flex"
          onClick={() => setCreateOpen(true)}
          data-testid="mobile-create-bug"
        >
          <Plus size={14} />
          录缺陷
        </button>

        {activeFilters > 0 && (
          <button className="vh-btn ghost h-8 text-xs" onClick={() => { setFilters({}); setSearch(''); }}>
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
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-2 text-xs">
          <label className="flex items-center gap-1.5">
            严重度
            <select className="h-7 rounded border border-[var(--border-strong)] bg-[var(--bg-page)] px-1" value={filters.severity ?? ''} onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value || undefined }))}>
              <option value="">全部</option>
              <option value="low">低</option><option value="normal">中</option><option value="high">高</option><option value="critical">紧急</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            标签
            <select className="h-7 rounded border border-[var(--border-strong)] bg-[var(--bg-page)] px-1" value={filters.label ?? ''} onChange={(e) => setFilters((f) => ({ ...f, label: e.target.value || undefined }))}>
              <option value="">全部</option>
              {allLabels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
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
            void store.moveBug(bugId, status);
            flash(bugId);
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
            if (result.updated > 0) {
              toast.success(`已更新 ${result.updated} 项`, {
                action: { label: '撤销', onClick: () => toast.info('请手动改回原状态') },
              });
            }
            setSelectedIds([]);
          }}
        />
      )}

      {/* 右键菜单 */}
      {menu && (
        <BugContextMenu
          x={menu.x}
          y={menu.y}
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
          onDelete={canEdit ? () => {
            const id = menu.bugId;
            setMenu(null);
            void store.deleteBug(id);
            toast.success('已删除 1 个缺陷', {
              action: { label: '撤销', onClick: () => toast.info('删除不可自动撤销') },
            });
          } : undefined}
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
          onUpdate={store.updateBug}
          onDelete={store.deleteBug}
          onRefreshBoard={store.refreshBoard}
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

/** 缺陷右键菜单 */
function BugContextMenu({
  x, y, onClose, onCopy, onOpen, onDelete,
}: {
  x: number; y: number; onClose: () => void;
  onCopy: () => void; onOpen: () => void; onDelete?: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [onClose]);

  return (
    <div
      className="fixed z-50 min-w-36 overflow-hidden rounded-[10px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] py-1 shadow-lg"
      style={{ left: x, top: y }}
      data-testid="bug-context-menu"
    >
      <button className="vh-menu-item" onClick={onOpen}>打开详情</button>
      <button className="vh-menu-item" onClick={onCopy}>复制标题</button>
      {onDelete && <button className="vh-menu-item text-[var(--danger)]" onClick={onDelete}>删除</button>}
    </div>
  );
}
