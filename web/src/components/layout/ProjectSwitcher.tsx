'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, FolderPlus, Settings2 } from 'lucide-react';
import { buildSearchIndex, matchIndex } from '@/lib/search';
import { useCanEdit } from '@/lib/auth';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/api-types';

interface ProjectSwitcherProps {
  projects: Project[];
  current: Project | null;
  onSelect: (projectId: string) => void;
  onCreate: (name: string) => void;
  align?: 'left' | 'right';
  collapsed?: boolean;
}

/** 左上角工作区根容器切换器：选定项目后全站数据严格物理隔离 */
export function ProjectSwitcher({
  projects,
  current,
  onSelect,
  onCreate,
  align = 'left',
  collapsed = false,
}: ProjectSwitcherProps) {
  const router = useRouter();
  const canEdit = useCanEdit();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');

  const activeProjects = projects.filter((p) => !p.archived_at);
  const filtered = query.trim()
    ? activeProjects.filter((p) => matchIndex(query, buildSearchIndex(p.name, `${p.slug} ${p.description ?? ''}`)))
    : activeProjects;

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName('');
    setOpen(false);
  };

  const monogram = (current?.name ?? 'P').trim().slice(0, 1).toUpperCase();

  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        className={cn(
          'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-elevated)]',
          collapsed && 'justify-center px-0',
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="切换当前项目"
        title={collapsed ? `当前项目：${current?.name ?? '未选择'}` : undefined}
        data-testid="project-switcher"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)] text-xs font-semibold text-white shadow-xs">
          {monogram}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight text-[var(--text-primary)]">
                {current?.name ?? '选择工作区项目'}
              </span>
              <span className="t-mono block truncate text-[10px] leading-tight text-[var(--text-tertiary)]">
                {current ? current.slug : '独立项目隔离空间'}
              </span>
            </span>
            <ChevronsUpDown size={13} className="shrink-0 text-[var(--text-tertiary)]" />
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={cn(
              'absolute top-11 z-50 w-72 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-card)] p-2 shadow-[var(--shadow-2)]',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            <div className="mb-1.5 flex items-center justify-between px-1.5 pt-0.5">
              <span className="text-[11px] font-medium text-[var(--text-tertiary)]">切换项目工作区（严格物理隔离）</span>
            </div>
            <input
              autoFocus
              className="vh-input-compact mb-1.5 w-full"
              placeholder="搜索项目名称或拼音…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="project-search-input"
            />
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {filtered.map((p) => {
                const selected = p.id === current?.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                      selected
                        ? 'bg-[var(--brand-soft)] font-medium text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]',
                    )}
                    onClick={() => {
                      onSelect(p.id);
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--bg-elevated)] text-[10px] font-semibold text-[var(--text-secondary)]">
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="t-mono shrink-0 text-[10px] text-[var(--text-tertiary)]">{p.slug}</span>
                    {selected && <Check size={13} className="shrink-0 text-[var(--brand)]" />}
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-[var(--text-tertiary)]">没有匹配的项目</p>
              )}
            </div>

            {canEdit && (
              <div className="mt-2 flex gap-1.5 border-t border-[var(--border-subtle)] pt-2">
                <input
                  className="vh-input-compact min-w-0 flex-1"
                  placeholder="新建项目名称…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && create()}
                />
                <button
                  type="button"
                  className="vh-btn h-8 px-2.5 text-xs"
                  disabled={!newName.trim()}
                  onClick={create}
                  aria-label="创建项目"
                >
                  <FolderPlus size={13} />
                </button>
              </div>
            )}

            <button
              type="button"
              className="mt-1.5 flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              onClick={() => {
                setOpen(false);
                router.push('/projects');
              }}
            >
              <Settings2 size={12} />
              管理全部项目与归档…
            </button>
          </div>
        </>
      )}
    </div>
  );
}
