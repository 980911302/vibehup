'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, FolderKanban, Image as ImageIcon, ListChecks, Moon, Puzzle, BarChart3, Search, Sparkles, StickyNote, Sun } from 'lucide-react';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { useToast } from '@/lib/toast';
import { BUG_STATUS_LABELS, SEVERITY_LABELS, type SearchResults } from '@/lib/api-types';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/lib/task-flow';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNewBug: () => void;
}

/** 命令面板（⌘K）：搜索 + 导航 + 动作（步骤 06 §6.5） */
export function CommandPalette({ open, onClose, onNewBug }: CommandPaletteProps) {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // 搜索防抖
  useEffect(() => {
    if (!open || !query.trim()) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await api.search(query.trim());
        if (!cancelled) setResults(data);
      } catch {
        // 搜索失败静默
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const actions = useMemo(
    () => [
      { id: 'nav-board', icon: FolderKanban, label: '跳转：缺陷看板', hint: 'G B', run: () => router.push('/board') },
      { id: 'nav-files', icon: ImageIcon, label: '跳转：文件', hint: 'G F', run: () => router.push('/files') },
      { id: 'nav-notes', icon: StickyNote, label: '跳转：随手记', hint: 'G N', run: () => router.push('/notes') },
      { id: 'nav-tasks', icon: ListChecks, label: '跳转：任务', hint: 'G T', run: () => router.push('/tasks') },
      { id: 'nav-skills', icon: Puzzle, label: '跳转：技能', hint: 'G S', run: () => router.push('/skills') },
      { id: 'nav-stats', icon: BarChart3, label: '跳转：统计', hint: 'G D', run: () => router.push('/stats') },
      { id: 'nav-projects', icon: FolderKanban, label: '跳转：项目', hint: 'G P', run: () => router.push('/projects') },
      { id: 'nav-keys', icon: FileText, label: '跳转：MCP 密钥', hint: 'G K', run: () => router.push('/keys') },
      { id: 'nav-members', icon: StickyNote, label: '跳转：成员', hint: 'G M', run: () => router.push('/members') },
      { id: 'act-new-bug', icon: FileText, label: '动作：新建缺陷', hint: 'C', run: onNewBug },
      {
        id: 'act-theme',
        icon: theme === 'midnight' ? Sun : Moon,
        label: `动作：切换到${theme === 'midnight' ? '纸白' : '暗色'}主题`,
        hint: '',
        run: () => {
          toggle();
          toast.info(`已切换到${theme === 'midnight' ? '纸白' : '暗色'}主题`);
        },
      },
    ],
    [router, onNewBug, theme, toggle, toast],
  );

  type Row =
    | { kind: 'action'; id: string; icon: typeof Search; label: string; hint: string; run: () => void }
    | { kind: 'bug'; id: string; icon: typeof Search; label: string; hint: string; run: () => void }
    | { kind: 'task'; id: string; icon: typeof Search; label: string; hint: string; run: () => void }
    | { kind: 'project'; id: string; icon: typeof Search; label: string; hint: string; run: () => void }
    | { kind: 'note'; id: string; icon: typeof Search; label: string; hint: string; run: () => void }
    | { kind: 'sem-header'; id: string }
    | { kind: 'sem'; id: string; icon: typeof Search; label: string; hint: string; run: () => void };

  const rows: Row[] = useMemo(() => {
    const actionRows: Row[] = actions
      .filter((a) => !query.trim() || a.label.toLowerCase().includes(query.toLowerCase()))
      .map((a) => ({ kind: 'action' as const, id: a.id, icon: a.icon, label: a.label, hint: a.hint, run: a.run }));
    const bugRows: Row[] = (results?.bugs ?? []).map((b) => ({
      kind: 'bug' as const,
      id: `bug-${b.id}`,
      icon: FileText,
      label: b.title,
      hint: `${BUG_STATUS_LABELS[b.status]} · ${SEVERITY_LABELS[b.severity]}`,
      run: () => router.push(`/board?bug=${b.id}`),
    }));
    const taskRows: Row[] = (results?.tasks ?? []).map((t) => ({
      kind: 'task' as const,
      id: `tsk-${t.id}`,
      icon: ListChecks,
      label: t.title,
      hint: TASK_STATUS_LABELS[t.status as TaskStatus] ?? t.status,
      run: () => router.push(`/tasks?task=${t.id}`),
    }));
    const projectRows: Row[] = (results?.projects ?? []).map((p) => ({
      kind: 'project' as const,
      id: `prj-${p.id}`,
      icon: FolderKanban,
      label: p.name,
      hint: p.slug,
      run: () => router.push('/projects'),
    }));
    const noteRows: Row[] = (results?.notes ?? []).map((n) => ({
      kind: 'note' as const,
      id: `nte-${n.id}`,
      icon: StickyNote,
      label: n.content.slice(0, 50),
      hint: n.tags.join(' · '),
      run: () => router.push('/notes'),
    }));
    // 语义相似分组（卡片 34）：AI 近邻结果金色星尘标识，与关键词结果区分；为空不渲染
    const semanticRows: Row[] = [
      ...(results?.similar?.bugs ?? []).map((b) => ({
        kind: 'sem' as const,
        id: `sem-bug-${b.id}`,
        icon: Sparkles,
        label: b.title,
        hint: 'AI 语义命中',
        run: () => router.push(`/board?bug=${b.id}`),
      })),
      ...(results?.similar?.notes ?? []).map((n) => ({
        kind: 'sem' as const,
        id: `sem-nte-${n.id}`,
        icon: Sparkles,
        label: n.content.slice(0, 50),
        hint: 'AI 语义命中',
        run: () => router.push('/notes'),
      })),
    ];
    // 行数预算 12：语义组占 1 行标题 + N 行，从关键词结果里预留，保证语义组可见
    const semanticBudget = semanticRows.length > 0 ? Math.min(semanticRows.length + 1, 4) : 0;
    const keywordRows = [...actionRows, ...bugRows, ...taskRows, ...projectRows, ...noteRows].slice(0, 12 - semanticBudget);
    const semanticSection: Row[] = semanticRows.length > 0
      ? [{ kind: 'sem-header' as const, id: 'sem-header' }, ...semanticRows.slice(0, semanticBudget - 1)]
      : [];
    return [...keywordRows, ...semanticSection];
  }, [actions, results, query, router]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, results]);

  if (!open) return null;

  const runRow = (row: Row) => {
    if (!('run' in row)) return; // 分组标题不可交互
    row.run();
    onClose();
  };

  return (
    <div className="vh-modal-mask" onClick={onClose}>
      <div className="vh-palette" onClick={(e) => e.stopPropagation()} data-testid="command-palette">
        <div className="vh-palette-input">
          <Search size={16} />
          <input
            ref={inputRef}
            placeholder="搜索缺陷、项目、便签，或输入动作…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && rows[activeIndex]) {
                e.preventDefault();
                runRow(rows[activeIndex]);
              }
            }}
          />
          <span className="vh-kbd">Esc</span>
        </div>
        <div className="vh-palette-list">
          {rows.length === 0 && (
            <div className="py-6 text-center">
              <p className="text-[13px] text-[var(--text-secondary)]">没有匹配的结果</p>
              <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">换个说法试试——搜索支持语义理解，“按钮点了没反应”也能找到相关缺陷</p>
            </div>
          )}
          {rows.map((row, i) => {
            // 语义分组标题：不可交互，金色星尘 + 说明（与看板 AI 徽章同源）
            if (row.kind === 'sem-header') {
              return (
                <div key={row.id} className="vh-palette-group" data-testid="semantic-group-header">
                  <Sparkles size={11} strokeWidth={2.2} />
                  语义相似（AI）
                  <span className="vh-palette-group-note">理解你的说法，不只是字面匹配</span>
                </div>
              );
            }
            const Icon = 'icon' in row ? row.icon : FileText;
            const isSem = row.kind === 'sem';
            return (
              <button
                key={row.id}
                className={`vh-palette-row${i === activeIndex ? ' active' : ''}${isSem ? ' sem' : ''}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => runRow(row)}
              >
                <Icon size={14} className={isSem ? 'text-[var(--gold)]' : undefined} />
                <span className="vh-palette-label">{row.label}</span>
                <span className="vh-palette-hint">{row.hint}</span>
              </button>
            );
          })}
        </div>
      </div>
      <style jsx global>{`
        .vh-palette {
          width: min(680px, 92vw);
          background: var(--bg-panel); border: 1px solid var(--border-strong);
          border-radius: var(--r-panel); box-shadow: var(--shadow-3);
          backdrop-filter: var(--glass); overflow: hidden;
          animation: vh-modal-in 220ms var(--ease) 1;
        }
        .vh-palette-input {
          display: flex; align-items: center; gap: 10px; padding: 14px 16px;
          border-bottom: 1px solid var(--border-subtle); color: var(--text-tertiary);
        }
        .vh-palette-input input {
          flex: 1; background: none; border: none; outline: none;
          font-size: 14px; color: var(--text-primary);
        }
        .vh-palette-list { max-height: 46vh; overflow-y: auto; padding: 6px; }
        .vh-palette-row {
          display: flex; align-items: center; gap: 10px; width: 100%;
          padding: 9px 10px; border: none; border-radius: 10px; background: none;
          color: var(--text-secondary); font-size: 13px; cursor: pointer; text-align: left;
          border-left: 2px solid transparent;
        }
        .vh-palette-row.active { background: var(--gold-bg); color: var(--text-primary); border-left-color: var(--gold); }
        .vh-palette-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .vh-palette-hint { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; }
        .vh-palette-empty { text-align: center; color: var(--text-tertiary); font-size: 13px; padding: 24px 0; }
              .vh-palette-group {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 16px 4px; font-size: 11px; font-weight: 600;
          color: var(--gold); letter-spacing: .02em;
        }
        .vh-palette-group-star { font-size: 10px; }
        .vh-palette-group-note { font-weight: 400; color: var(--text-tertiary); }
        .vh-palette-row.sem .vh-palette-hint { color: var(--gold); }
`}</style>
    </div>
  );
}
