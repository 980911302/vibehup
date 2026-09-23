'use client';

import { FileSpreadsheet, Loader2, X } from 'lucide-react';
import type { TsvRow } from '@/lib/tsv-import';

interface TsvImportPanelProps {
  rows: TsvRow[];
  importing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Excel/TSV 批量导入预览（卡片 50）：解析行列表 + 确认创建。
 * 有 error 的行（如标题为空）创建时跳过，此处红色标注。
 */
export function TsvImportPanel({ rows, importing, onConfirm, onCancel }: TsvImportPanelProps) {
  const valid = rows.filter((r) => !r.error).length;
  const invalid = rows.length - valid;

  return (
    <div className="rounded-md border border-[var(--gold)] bg-[var(--gold-bg)]/40 p-3" data-testid="tsv-import-panel">
      <div className="mb-2 flex items-center gap-2">
        <FileSpreadsheet size={14} className="text-[var(--gold)]" />
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          检测到表格粘贴 · {valid} 条可导入{invalid > 0 && <span className="text-[var(--danger)]">（{invalid} 条将跳过）</span>}
        </span>
        <div className="flex-1" />
        <button className="rounded p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer" onClick={onCancel} title="取消导入">
          <X size={13} />
        </button>
      </div>
      <ul className="max-h-40 space-y-1 overflow-y-auto">
        {rows.map((r, i) => (
          <li
            key={i}
            className={cnRow(r.error)}
            data-testid="tsv-import-row"
          >
            <span className="w-5 shrink-0 text-right text-[10px] text-[var(--text-tertiary)]">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-primary)]">{r.title || '（无标题）'}</span>
            {r.severity && <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">{severityLabel(r.severity)}</span>}
            {r.error && <span className="shrink-0 text-[10px] text-[var(--danger)]">{r.error}</span>}
            {r.steps && <span className="w-32 shrink-0 truncate text-[10px] text-[var(--text-tertiary)]">{r.steps}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end gap-2">
        <button className="vh-btn ghost text-xs" onClick={onCancel} disabled={importing}>
          取消
        </button>
        <button className="vh-btn text-xs" onClick={onConfirm} disabled={importing || valid === 0} data-testid="tsv-import-confirm">
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          创建 {valid} 条缺陷
        </button>
      </div>
    </div>
  );
}

function cnRow(error?: string): string {
  const base = 'flex items-center gap-2 rounded px-2 py-1';
  return error ? `${base} bg-[var(--danger)]/10` : `${base} bg-[var(--bg-card)]`;
}

function severityLabel(s: NonNullable<TsvRow['severity']>): string {
  return s === 'low' ? '低' : s === 'normal' ? '中' : s === 'high' ? '高' : '紧急';
}
