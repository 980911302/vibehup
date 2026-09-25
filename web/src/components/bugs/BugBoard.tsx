'use client';

import { useRef, useState } from 'react';
import { BugCard } from './BugCard';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { BUG_STATUS_LABELS, type Bug, type BugBoard as Board } from '@/lib/api-types';
import { bugDropRejectReason, canDropBug } from '@/lib/bug-flow';

const COLUMNS: { key: keyof Board; label: string; accent: string }[] = [
  { key: 'open', label: BUG_STATUS_LABELS.open, accent: 'var(--sev-critical)' },
  { key: 'in_progress', label: BUG_STATUS_LABELS.in_progress, accent: 'var(--sev-high)' },
  { key: 'resolved', label: BUG_STATUS_LABELS.resolved, accent: 'var(--ok)' },
  { key: 'verifying', label: BUG_STATUS_LABELS.verifying, accent: 'var(--gold)' },
  { key: 'verified', label: BUG_STATUS_LABELS.verified, accent: 'var(--brand)' },
  { key: 'closed', label: BUG_STATUS_LABELS.closed, accent: 'var(--text-tertiary)' },
];

interface BugBoardProps {
  board: Board;
  thumbnails: Record<string, string>;
  flashIds: Set<string>;
  canEdit: boolean;
  onMoveBug: (bugId: string, status: Bug['status']) => void;
  onOpenBug: (bugId: string, e: React.MouseEvent) => void;
  onContextMenu: (bugId: string, e: React.MouseEvent) => void;
  onSelectionChange: (ids: string[]) => void;
  selectedIds: string[];
}

/**
 * 缺陷看板（UI 规范 §2.6）：每个状态一列（R83 起六列，含验证中）+ 拖拽 + 多选。
 * 拖拽 ID 走 ref（R1 教训：React 状态批处理下 drop 时闭包会读到过期值）。
 */
export function BugBoard({
  board, thumbnails, flashIds, canEdit,
  onMoveBug, onOpenBug, onContextMenu, onSelectionChange, selectedIds,
}: BugBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [rejectCol, setRejectCol] = useState<string | null>(null);
  const toast = useToast();
  const selectedRef = useRef<Set<string>>(new Set());
  selectedRef.current = new Set(selectedIds);

  const startDrag = (bugId: string) => {
    draggingRef.current = bugId;
    setDraggingId(bugId);
  };
  const endDrag = () => {
    draggingRef.current = null;
    setDraggingId(null);
    setDragOverCol(null);
  };

  const findBug = (bugId: string | null) => (bugId ? Object.values(board).flat().find((b) => b.id === bugId) : undefined);
  /** 拖动中的缺陷可以落到哪些列：只有合法的下一步（重开要写原因，不能直接拖） */
  const draggingBug = findBug(draggingId);

  const handleDrop = (target: keyof Board) => {
    const bugId = draggingRef.current;
    endDrag();
    if (!bugId) return;
    if (!canEdit) {
      setRejectCol(target);
      toast.error('当前角色为只读，无法变更缺陷状态');
      setTimeout(() => setRejectCol(null), 300);
      return;
    }
    const bug = findBug(bugId);
    if (!bug || bug.status === target) return;
    if (!canDropBug(bug.status, target)) {
      setRejectCol(target);
      toast.error(bugDropRejectReason(bug.status, target));
      setTimeout(() => setRejectCol(null), 200);
      return;
    }
    onMoveBug(bugId, target as Bug['status']);
  };

  const toggleSelect = (bugId: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      const next = new Set(selectedRef.current);
      next.has(bugId) ? next.delete(bugId) : next.add(bugId);
      onSelectionChange([...next]);
      return;
    }
    if (e.shiftKey && selectedRef.current.size > 0) {
      // 范围选择：同列内从锚点到当前
      e.preventDefault();
      e.stopPropagation();
      const flat = Object.values(board).flat().map((b) => b.id);
      const ids = [...selectedRef.current, bugId];
      const first = Math.min(...ids.map((id) => flat.indexOf(id)).filter((i) => i >= 0));
      const last = Math.max(...ids.map((id) => flat.indexOf(id)).filter((i) => i >= 0));
      const next = new Set(flat.slice(first, last + 1));
      onSelectionChange([...next]);
      return;
    }
    if (selectedRef.current.size > 0) {
      // 已有多选时点击非修饰键 = 清空选择并打开
      onSelectionChange([]);
    }
    onOpenBug(bugId, e);
  };

  return (
    <div className="flex h-full gap-3 overflow-x-auto pb-2" data-testid="bug-board">
      {COLUMNS.map((col) => {
        const bugs = board[col.key] ?? [];
        const droppable = draggingBug ? canDropBug(draggingBug.status, col.key) : false;
        const isOver = dragOverCol === col.key && droppable;
        return (
          <div
            key={col.key}
            data-testid={`board-column-${col.key}`}
            className={cn(
              'flex min-h-32 min-w-[150px] flex-1 flex-col rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] transition-[opacity,border-color]',
              draggingBug && !droppable && draggingBug.status !== col.key && 'opacity-50',
              isOver && 'border-[var(--gold)] bg-[var(--gold-bg)]',
              rejectCol === col.key && 'animate-[vh-shake_160ms_var(--ease)]',
            )}
            style={{ borderTop: `2px solid ${col.accent}` }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverCol(col.key);
            }}
            onDragLeave={() => setDragOverCol((prev) => (prev === col.key ? null : prev))}
            onDrop={() => handleDrop(col.key)}
          >
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">{col.label}</span>
              <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]">{bugs.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {bugs.map((bug) => (
                <BugCard
                  key={bug.id}
                  bug={bug}
                  thumbnailUrl={thumbnails[bug.id] ?? null}
                  selected={selectedRef.current.has(bug.id)}
                  dragging={draggingId === bug.id}
                  flash={flashIds.has(bug.id)}
                  onDragStart={() => startDrag(bug.id)}
                  onDragEnd={endDrag}
                  onClick={(e) => toggleSelect(bug.id, e)}
                  onContextMenu={(e) => onContextMenu(bug.id, e)}
                />
              ))}
              {bugs.length === 0 && (
                <p className="py-6 text-center text-xs text-[var(--text-tertiary)]">拖拽卡片到此</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
