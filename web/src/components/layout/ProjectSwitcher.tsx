'use client';

import { useState } from 'react';
import { ChevronDown, FolderPlus } from 'lucide-react';
import { buildSearchIndex, matchIndex } from '@/lib/search';
import type { Project } from '@/lib/api-types';

/** 项目切换器（设计文档 5.1：支持拼音/模糊检索） */
export function ProjectSwitcher({
  projects, current, onSelect, onCreate,
}: {
  projects: Project[];
  current: Project | null;
  onSelect: (projectId: string) => void;
  onCreate: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');

  const filtered = query.trim()
    ? projects.filter((p) => matchIndex(query, buildSearchIndex(p.name, `${p.slug} ${p.description ?? ''}`)))
    : projects;

  return (
    <div className="relative">
      <button
        className="vh-btn ghost h-8 gap-1.5 text-xs"
        onClick={() => setOpen((v) => !v)}
        data-testid="project-switcher"
      >
        <span className="max-w-[180px] truncate">{current?.name ?? '选择项目'}</span>
        <ChevronDown size={13} className="opacity-60" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-9 z-40 w-72 rounded-[14px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-2 shadow-lg">
            <input
              autoFocus
              className="mb-2 h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2 text-xs outline-none focus:border-[var(--brand)]"
              placeholder="搜索项目（拼音，如 yhzx）"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="project-search-input"
            />
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer hover:bg-[var(--bg-panel)] ${
                    p.id === current?.id ? 'bg-[var(--bg-panel)] text-[var(--brand)]' : 'text-[var(--text-secondary)]'
                  }`}
                  onClick={() => {
                    onSelect(p.id);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="ml-2 shrink-0 text-[10px] text-[var(--text-tertiary)]">{p.slug}</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-2.5 py-3 text-center text-xs text-[var(--text-tertiary)]">未找到匹配项目</p>
              )}
            </div>
            <div className="mt-2 flex gap-1.5 border-t border-[var(--border-subtle)] pt-2">
              <input
                className="h-8 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2 text-xs outline-none focus:border-[var(--brand)]"
                placeholder="新建项目名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) {
                    onCreate(newName.trim());
                    setNewName('');
                    setOpen(false);
                  }
                }}
              />
              <button
                className="vh-btn h-8 text-xs"
                disabled={!newName.trim()}
                onClick={() => {
                  if (!newName.trim()) return;
                  onCreate(newName.trim());
                  setNewName('');
                  setOpen(false);
                }}
              >
                <FolderPlus size={13} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
