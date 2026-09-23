'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { Bug, BugTemplate } from '@/lib/api-types';

interface BugFormExtrasProps {
  steps: string;
  onStepsChange: (v: string) => void;
  severity: Bug['severity'];
  onSeverityChange: (v: Bug['severity']) => void;
  assigneeId: string;
  onAssigneeChange: (v: string) => void;
  members: { id: string; name: string }[];
  templateId: string;
  templates: BugTemplate[];
  onTemplateChange: (id: string) => void;
}

/**
 * 快速录入的「更多选项」折叠区（卡片 50：轻量默认字段——
 * 标题必填即可发送，复现步骤/严重度/指派/模板收进这里）。
 */
export function BugFormExtras({
  steps, onStepsChange, severity, onSeverityChange,
  assigneeId, onAssigneeChange, members,
  templateId, templates, onTemplateChange,
}: BugFormExtrasProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border border-[var(--border-subtle)]">
      <button
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)] cursor-pointer"
        onClick={() => setOpen((v) => !v)}
        data-testid="bug-extras-toggle"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        更多选项
        <span className="ml-1 text-[10px] text-[var(--text-tertiary)]">复现步骤 · 严重度 · 指派 · 模板</span>
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-[var(--border-subtle)] p-3" data-testid="bug-extras-panel">
          <textarea
            className="flex min-h-[64px] w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 py-2 text-sm outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--brand)]"
            placeholder="复现步骤（选填）"
            value={steps}
            onChange={(e) => onStepsChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.preventDefault()}
            rows={3}
          />
          <div className="flex flex-wrap items-center gap-2">
            {templates.length > 0 && (
              <select
                className="h-8 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2 text-xs outline-none"
                value={templateId}
                onChange={(e) => onTemplateChange(e.target.value)}
              >
                <option value="">不使用模板</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <select
              className="h-8 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2 text-xs outline-none"
              value={assigneeId}
              onChange={(e) => onAssigneeChange(e.target.value)}
              data-testid="bug-assignee-select"
            >
              <option value="">未指派</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <div className="flex gap-1">
              {(['low', 'normal', 'high', 'critical'] as const).map((s) => (
                <button
                  key={s}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs transition-colors cursor-pointer',
                    severity === s ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
                      : 'border-[var(--border-strong)] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)]',
                  )}
                  onClick={() => onSeverityChange(s)}
                >
                  {s === 'low' ? '低' : s === 'normal' ? '中' : s === 'high' ? '高' : '紧急'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
