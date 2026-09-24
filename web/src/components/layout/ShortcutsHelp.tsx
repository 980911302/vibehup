'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { GLOBAL_HOTKEYS } from '@/lib/shortcuts';

/** 快捷键帮助（? 全屏速查表；与 GLOBAL_HOTKEYS 注册表同源） */
export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const groups = [...new Set(GLOBAL_HOTKEYS.map((h) => h.group))];

  return (
    <div className="vh-modal-mask" onClick={onClose}>
      <div className="vh-shortcuts-panel" onClick={(e) => e.stopPropagation()} data-testid="shortcuts-help">
        <header>
          <h2>键盘快捷键</h2>
          <button className="vh-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="vh-shortcuts-grid">
          {groups.map((group) => (
            <section key={group}>
              <h3>{group}</h3>
              {GLOBAL_HOTKEYS.filter((h) => h.group === group).map((h) => (
                <div key={h.combo} className="vh-shortcut-row">
                  <span className="vh-kbd">{formatCombo(h.combo)}</span>
                  <span>{h.description}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
      <style jsx global>{`
        .vh-shortcuts-panel {
          width: min(640px, 92vw); max-height: 70vh; overflow-y: auto;
          background: var(--bg-panel); border: 1px solid var(--border-strong);
          border-radius: var(--r-panel); box-shadow: var(--shadow-3);
          animation: vh-modal-in 220ms var(--ease) 1;
        }
        .vh-shortcuts-panel header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px; border-bottom: 1px solid var(--border-subtle);
        }
        .vh-shortcuts-panel h2 { margin: 0; font-size: 16px; color: var(--text-primary); }
        .vh-shortcuts-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 8px 32px; padding: 16px 20px 24px;
        }
        @media (max-width: 640px) { .vh-shortcuts-grid { grid-template-columns: 1fr; } }
        .vh-shortcuts-grid h3 {
          margin: 12px 0 6px; font-size: 11px; text-transform: uppercase;
          letter-spacing: .08em; color: var(--text-tertiary);
        }
        .vh-shortcut-row {
          display: flex; align-items: center; gap: 10px;
          padding: 5px 0; font-size: 13px; color: var(--text-secondary);
        }
      `}</style>
    </div>
  );
}

function formatCombo(combo: string): string {
  return combo
    .split(' ')
    .map((part) => {
      if (part === 'mod') return '⌘';
      if (part === 'enter') return '↵';
      if (part === 'esc') return 'Esc';
      if (part === '↑' || part === '↓') return part;
      return part.toUpperCase();
    })
    .join(' ');
}
