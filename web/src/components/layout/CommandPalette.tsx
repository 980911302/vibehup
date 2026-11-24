'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Bug,
  FileText,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Moon,
  Plus,
  Puzzle,
  Search,
  Settings2,
  Sparkles,
  StickyNote,
  Sun,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useWorkOverlay } from '@/components/work/WorkItemOverlay';
import { useCanEdit } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { useToast } from '@/lib/toast';
import { BUG_STATUS_LABELS, SEVERITY_LABELS, type SearchResults } from '@/lib/api-types';
import { TASK_STATUS_LABELS, type TaskStatus } from '@/lib/task-flow';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNewBug?: () => void;
}

/** 命令面板（⌘K）：严格检索当前隔离项目的缺陷、任务、便签，点开即原地展示详情 */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const store = useVibeHub();
  const overlay = useWorkOverlay();
  const canEdit = useCanEdit();
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const projectId = store.currentProject?.id ?? null;

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !query.trim() || !projectId) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await api.search(query.trim(), projectId);
        if (!cancelled) setResults(data);
      } catch {
        // 搜索失败静默
      }
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const actions = useMemo(() => {
    const base = [
      ...(canEdit
        ? [
            { id: 'act-new-bug', icon: Plus, label: '新建：录入缺陷', hint: 'C', run: () => overlay.openCreateBug() },
            { id: 'act-new-task', icon: ListChecks, label: '新建：创建任务', hint: '', run: () => overlay.openCreateTask() },
          ]
        : []),
      { id: 'nav-today', icon: LayoutDashboard, label: '前往：项目概览', hint: 'G D', run: () => router.push('/today') },
      { id: 'nav-work-bug', icon: Bug, label: '前往：缺陷', hint: 'G B', run: () => router.push('/work/bugs') },
      { id: 'nav-work-task', icon: ListChecks, label: '前往：任务', hint: 'G T', run: () => router.push('/work/tasks') },
      { id: 'nav-context-notes', icon: StickyNote, label: '前往：随手记', hint: 'G N', run: () => router.push('/context/notes') },
      { id: 'nav-context-files', icon: FolderOpen, label: '前往：文件', hint: 'G F', run: () => router.push('/context/files') },
      { id: 'nav-context-skills', icon: Puzzle, label: '前往：技能', hint: '', run: () => router.push('/context/skills') },
      { id: 'nav-stats', icon: BarChart3, label: '前往：统计', hint: '', run: () => router.push('/stats') },
      { id: 'nav-keys', icon: KeyRound, label: '全局：MCP 密钥', hint: 'G K', run: () => router.push('/keys') },
      { id: 'nav-settings', icon: Settings2, label: '全局：个人与团队设置', hint: 'G S', run: () => router.push('/settings') },
      {
        id: 'act-theme',
        icon: theme === 'midnight' ? Sun : Moon,
        label: `偏好：切换到${theme === 'midnight' ? '纸白' : '暗色'}主题`,
        hint: '',
        run: () => {
          toggle();
          toast.info(`已切换到${theme === 'midnight' ? '纸白' : '暗色'}主题`);
        },
      },
    ];
    return base;
  }, [canEdit, overlay, router, theme, toggle, toast]);

  type Row =
    | { kind: 'action' | 'bug' | 'task' | 'note' | 'sem'; id: string; icon: typeof Search; label: string; hint: string; run: () => void }
    | { kind: 'sem-header'; id: string };

  const rows: Row[] = useMemo(() => {
    const actionRows: Row[] = actions
      .filter((a) => !query.trim() || a.label.toLowerCase().includes(query.toLowerCase()))
      .map((a) => ({ kind: 'action' as const, id: a.id, icon: a.icon, label: a.label, hint: a.hint, run: a.run }));
    const bugRows: Row[] = (results?.bugs ?? []).map((b) => ({
      kind: 'bug' as const,
      id: `bug-${b.id}`,
      icon: Bug,
      label: b.title,
      hint: `${BUG_STATUS_LABELS[b.status]} · ${SEVERITY_LABELS[b.severity]}`,
      run: () => overlay.openItem('bug', b.id),
    }));
    const taskRows: Row[] = (results?.tasks ?? []).map((t) => ({
      kind: 'task' as const,
      id: `tsk-${t.id}`,
      icon: ListChecks,
      label: t.title,
      hint: TASK_STATUS_LABELS[t.status as TaskStatus] ?? t.status,
      run: () => overlay.openItem('task', t.id),
    }));
    const noteRows: Row[] = (results?.notes ?? []).map((n) => ({
      kind: 'note' as const,
      id: `nte-${n.id}`,
      icon: StickyNote,
      label: n.content.slice(0, 60),
      hint: n.tags.join(' · ') || '随手记',
      run: () => router.push('/context/notes'),
    }));
    const semanticRows: Row[] = [
      ...(results?.similar?.bugs ?? []).map((b) => ({
        kind: 'sem' as const,
        id: `sem-bug-${b.id}`,
        icon: Sparkles,
        label: b.title,
        hint: 'AI 语义命中',
        run: () => overlay.openItem('bug', b.id),
      })),
      ...(results?.similar?.notes ?? []).map((n) => ({
        kind: 'sem' as const,
        id: `sem-nte-${n.id}`,
        icon: Sparkles,
        label: n.content.slice(0, 60),
        hint: 'AI 语义命中',
        run: () => router.push('/context/notes'),
      })),
    ];
    const semanticBudget = semanticRows.length > 0 ? Math.min(semanticRows.length + 1, 4) : 0;
    const keywordRows = [...bugRows, ...taskRows, ...noteRows, ...actionRows].slice(0, 12 - semanticBudget);
    const semanticSection: Row[] =
      semanticRows.length > 0 ? [{ kind: 'sem-header' as const, id: 'sem-header' }, ...semanticRows.slice(0, semanticBudget - 1)] : [];
    return [...keywordRows, ...semanticSection];
  }, [actions, results, query, overlay, router]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, results]);

  if (!open) return null;

  const runRow = (row: Row) => {
    if (!('run' in row)) return;
    onClose();
    row.run();
  };

  return (
    <div className="vh-modal-mask" onClick={onClose}>
      <div className="vh-palette" onClick={(e) => e.stopPropagation()} data-testid="command-palette">
        <div className="vh-palette-input">
          <Search size={15} />
          <input
            ref={inputRef}
            placeholder={
              store.currentProject
                ? `在「${store.currentProject.name}」中搜索缺陷、任务、随手记或执行动作…`
                : '输入动作或跳转指令…'
            }
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
          {store.currentProject && (
            <span className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-tertiary)]">
              仅当前项目
            </span>
          )}
          <span className="vh-kbd">Esc</span>
        </div>
        <div className="vh-palette-list">
          {rows.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-sm text-[var(--text-secondary)]">当前项目没有匹配结果</p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">换个关键词试试——搜索已严格限定在当前工作区项目内</p>
            </div>
          )}
          {rows.map((row, i) => {
            if (row.kind === 'sem-header') {
              return (
                <div key={row.id} className="vh-palette-group" data-testid="semantic-group-header">
                  <Sparkles size={11} strokeWidth={2.2} />
                  语义相似（AI）
                  <span className="vh-palette-group-note">理解你的描述，仅限当前项目</span>
                </div>
              );
            }
            const Icon = 'icon' in row ? row.icon : FileText;
            const isSem = row.kind === 'sem';
            return (
              <button
                key={row.id}
                type="button"
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
          width: min(640px, 92vw);
          background: var(--bg-panel); border: 1px solid var(--border-strong);
          border-radius: 14px; box-shadow: var(--shadow-3);
          backdrop-filter: var(--glass); overflow: hidden;
          animation: vh-modal-in 180ms var(--ease) 1;
        }
        .vh-palette-input {
          display: flex; align-items: center; gap: 10px; padding: 12px 14px;
          border-bottom: 1px solid var(--border-subtle); color: var(--text-tertiary);
        }
        .vh-palette-input input {
          flex: 1; background: none; border: none; outline: none;
          font-size: 13px; color: var(--text-primary);
        }
        .vh-palette-list { max-height: 48vh; overflow-y: auto; padding: 6px; }
        .vh-palette-row {
          display: flex; align-items: center; gap: 10px; width: 100%;
          padding: 8px 10px; border: none; border-radius: 8px; background: none;
          color: var(--text-secondary); font-size: 13px; cursor: pointer; text-align: left;
        }
        .vh-palette-row.active { background: var(--bg-elevated); color: var(--text-primary); }
        .vh-palette-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .vh-palette-hint { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; }
        .vh-palette-group {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 12px 4px; font-size: 11px; font-weight: 600;
          color: var(--gold); letter-spacing: .02em;
        }
        .vh-palette-group-note { font-weight: 400; color: var(--text-tertiary); }
        .vh-palette-row.sem .vh-palette-hint { color: var(--gold); }
      `}</style>
    </div>
  );
}
