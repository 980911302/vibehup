'use client';

import { useState } from 'react';
import { ChevronDown, FolderPlus } from 'lucide-react';
import { buildSearchIndex, matchIndex } from '@/lib/search';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/api-types';

/** 项目切换器（支持拼音/模糊检索；顶栏右对齐与紧凑两种形态） */
export function ProjectSwitcher({
  projects,
  current,
  onSelect,
  onCreate,
  align = 'left',
  compact = false,
}: {
  projects: Project[];
  current: Project | null;
  onSelect: (projectId: string) => void;
  onCreate: (name: string) => void;
  align?: 'left' | 'right';
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');

  const filtered = query.trim()
    ? projects.filter((p) => matchIndex(query, buildSearchIndex(p.name, `${p.slug} ${p.description ?? ''}`)))
    : projects;

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName('');
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        className={cn(
          'vh-btn ghost h-9 gap-1.5 border-[var(--border-subtle)] px-3 text-[var(--text-secondary)]',
          compact && 'max-w-[190px]',
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="切换当前项目"
        data-testid="project-switcher"
      >
        <span className="truncate">{current?.name ?? '选择项目'}</span>
        <ChevronDown size={13} className="shrink-0 opacity-60" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className={cn(
              'absolute top-11 z-40 w-80 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 shadow-[var(--shadow-2)]',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            <input
              autoFocus
              className="mb-2 h-9 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
              placeholder="搜索项目，支持拼音"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="project-search-input"
            />
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer',
                    p.id === current?.id
                      ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]',
                  )}
                  onClick={() => {
                    onSelect(p.id);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="t-caption-5 ml-2 shrink-0 text-[var(--text-tertiary)]">{p.slug}</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="t-caption-2 px-3 py-4 text-center text-[var(--text-tertiary)]">未找到匹配项目</p>
              )}
            </div>
            <div className="mt-2 flex gap-2 border-t border-[var(--border-subtle)] pt-2">
              <input
                className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
                placeholder="新建项目名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
              />
              <button className="vh-btn px-3" disabled={!newName.trim()} onClick={create} aria-label="创建项目">
                <FolderPlus size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
