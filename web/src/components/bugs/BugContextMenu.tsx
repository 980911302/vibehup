'use client';

import { useEffect, useState } from 'react';

interface BugContextMenuProps {
  x: number;
  y: number;
  canDelete: boolean;
  onClose: () => void;
  onCopy: () => void;
  onOpen: () => void;
  onDelete: () => void;
}

/**
 * 缺陷右键菜单。删除要二次确认（功能巡检 B6：此前一点就硬删，提示条还带一个不起作用的「撤销」）。
 */
export function BugContextMenu({ x, y, canDelete, onClose, onCopy, onOpen, onDelete }: BugContextMenuProps) {
  const [confirming, setConfirming] = useState(false);

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
      {confirming ? (
        <div className="px-3 py-2 text-xs text-[var(--text-secondary)]" onClick={(e) => e.stopPropagation()}>
          <p className="mb-2">删除后无法恢复，确定删除？</p>
          <div className="flex gap-1.5">
            <button className="vh-btn danger h-7 text-xs" onClick={onDelete} data-testid="bug-menu-delete-confirm">确认删除</button>
            <button className="vh-btn ghost h-7 text-xs" onClick={onClose}>取消</button>
          </div>
        </div>
      ) : (
        <>
          <button className="vh-menu-item" onClick={onOpen}>打开详情</button>
          <button className="vh-menu-item" onClick={onCopy}>复制标题</button>
          {canDelete && (
            <button
              className="vh-menu-item text-[var(--danger)]"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(true);
              }}
              data-testid="bug-menu-delete"
            >
              删除
            </button>
          )}
        </>
      )}
    </div>
  );
}
