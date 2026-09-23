'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, Copy, FolderPlus, Trash2 } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { Project } from '@/lib/api-types';

/** 项目页（步骤 07 §7.4）：表格 + slug 复制 + 归档 + 删除确认 */
export default function ProjectsPage() {
  const store = useVibeHub();
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [newName, setNewName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  const copySlug = async (p: Project) => {
    await navigator.clipboard.writeText(p.slug);
    toast.success(`已复制 slug: ${p.slug}`);
  };

  const toggleArchive = async (p: Project) => {
    await api.updateProject(p.id, { archived_at: p.archived_at ? null : new Date().toISOString() });
    await store.refreshProjects();
    toast.success(p.archived_at ? '已恢复项目' : '已归档项目');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5">
        <span className="text-xs text-[var(--text-tertiary)]">{store.projects.length} 个项目</span>
        <div className="flex-1" />
        <input
          className="h-8 w-56 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-2.5 text-xs outline-none focus:border-[var(--brand)]"
          placeholder="新项目名称，Enter 创建"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim()) {
              void store.createProject(newName.trim());
              setNewName('');
              toast.success('项目已创建');
            }
          }}
        />
        <button
          className="vh-btn h-8 text-xs"
          disabled={!newName.trim()}
          onClick={() => {
            if (!newName.trim()) return;
            void store.createProject(newName.trim());
            setNewName('');
            toast.success('项目已创建');
          }}
        >
          <FolderPlus size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <table className="w-full text-sm" data-testid="projects-table">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-left text-xs text-[var(--text-tertiary)]">
              <th className="pb-2 pl-2 font-medium">名称</th>
              <th className="pb-2 font-medium">Slug（AI 匹配用）</th>
              <th className="pb-2 font-medium">状态</th>
              <th className="pb-2 font-medium">创建于</th>
              <th className="pb-2 pr-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {store.projects.map((p) => {
              const archived = p.archived_at;
              return (
                <tr key={p.id} className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--bg-panel)]" data-testid="project-row">
                  <td className="py-2.5 pl-2">
                    <button className="font-medium text-[var(--text-primary)] hover:text-[var(--brand)] cursor-pointer" onClick={() => { store.selectProject(p.id); router.push('/board'); }}>
                      {p.name}
                    </button>
                    {p.description && <p className="text-[11px] text-[var(--text-tertiary)] line-clamp-1">{p.description}</p>}
                  </td>
                  <td className="py-2.5">
                    <button className="flex items-center gap-1.5 rounded bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)] hover:text-[var(--brand)] cursor-pointer" onClick={() => void copySlug(p)} title="点击复制">
                      {p.slug}
                      <Copy size={11} className="opacity-50" />
                    </button>
                  </td>
                  <td className="py-2.5">
                    {archived ? (
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">已归档</span>
                    ) : (
                      <span className="rounded bg-[var(--ok)]/15 px-1.5 py-0.5 text-[10px] text-[var(--ok)]">活跃</span>
                    )}
                  </td>
                  <td className="py-2.5 text-[11px] text-[var(--text-tertiary)]">{p.created_at.slice(0, 10)}</td>
                  <td className="py-2.5 pr-2">
                    <div className="flex items-center justify-end gap-1.5">
                      <button className="vh-btn ghost h-7 text-xs" onClick={() => void toggleArchive(p)} title={archived ? '恢复项目' : '归档项目'}>
                        {archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                        {archived ? '恢复' : '归档'}
                      </button>
                      {isAdmin && (
                        <button className="vh-btn ghost h-7 text-xs text-[var(--danger)]" onClick={() => { setDeleteTarget(p); setDeleteConfirmText(''); }} title="删除项目">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {store.projects.length === 0 && (
          <div className="vh-empty">
            <span className="vh-empty-icon">📦</span>
            <p className="vh-empty-title">还没有项目</p>
            <p className="vh-empty-hint">在上方输入名称创建第一个项目</p>
          </div>
        )}
      </div>

      {/* 删除确认：输入项目名 + 数据说明 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDeleteTarget(null)}>
          <div className="w-[420px] rounded-[20px] border border-[var(--border-strong)] bg-[var(--bg-panel)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-base font-semibold text-[var(--text-primary)]">删除项目「{deleteTarget.name}」</h3>
            <p className="mb-3 text-xs leading-relaxed text-[var(--text-secondary)]">
              将删除该项目下的全部缺陷、任务、便签与附件（附件文件进入回收站保留 30 天）。
              仓库/代码不受影响。此操作不可撤销。
            </p>
            <p className="mb-1.5 text-xs text-[var(--text-tertiary)]">请输入项目名 <code className="rounded bg-[var(--bg-elevated)] px-1">{deleteTarget.name}</code> 以确认：</p>
            <input
              autoFocus
              className="mb-4 h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none focus:border-[var(--danger)]"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button className="vh-btn ghost" onClick={() => setDeleteTarget(null)}>取消</button>
              <button
                className="vh-btn bg-[var(--danger)] text-white"
                disabled={deleteConfirmText !== deleteTarget.name}
                onClick={async () => {
                  await api.deleteProject(deleteTarget.id);
                  setDeleteTarget(null);
                  await store.refreshProjects();
                  toast.success(`已删除项目 ${deleteTarget.name}`);
                }}
              >
                <Trash2 size={14} />
                永久删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
