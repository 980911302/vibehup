'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';

interface LabelEditorProps {
  value: string[];
  /** 项目里已有的标签，输入时给出补全 */
  suggestions: string[];
  disabled?: boolean;
  onChange: (labels: string[]) => void;
}

const MAX_LABEL_LENGTH = 32;

/** 标签编辑：回车添加、× 移除；补全项目里已有的标签 */
export function LabelEditor({ value, suggestions, disabled, onChange }: LabelEditorProps) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const label = raw.trim().slice(0, MAX_LABEL_LENGTH);
    setDraft('');
    if (!label || value.includes(label)) return;
    onChange([...value, label]);
  };
  const hints = draft.trim()
    ? suggestions.filter((s) => s.includes(draft.trim()) && !value.includes(s)).slice(0, 5)
    : [];

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="label-editor">
      {value.map((l) => (
        <span key={l} className="flex items-center gap-1 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
          #{l}
          {!disabled && (
            <button type="button" className="cursor-pointer text-[var(--text-tertiary)] hover:text-[var(--danger)]" onClick={() => onChange(value.filter((x) => x !== l))} aria-label={`移除标签 ${l}`}>
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <div className="relative">
          <div className="flex items-center gap-1 rounded border border-dashed border-[var(--border-strong)] px-1.5">
            <Plus size={10} className="text-[var(--text-tertiary)]" />
            <input
              className="h-6 w-24 bg-transparent text-[11px] outline-none"
              placeholder="加标签，回车"
              value={draft}
              maxLength={MAX_LABEL_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add(draft);
                }
              }}
              data-testid="label-input"
            />
          </div>
          {hints.length > 0 && (
            <div className="absolute left-0 top-7 z-10 min-w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1 shadow-lg">
              {hints.map((h) => (
                <button key={h} type="button" className="block w-full cursor-pointer rounded px-2 py-1 text-left text-[11px] hover:bg-[var(--bg-panel)]" onMouseDown={(e) => { e.preventDefault(); add(h); }}>
                  #{h}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
