'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, ArrowUpRight, Copy, FolderPlus, Package, Trash2 } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useAuth, useCanEdit } from '@/lib/auth';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import type { Project } from '@/lib/api-types';

/** 全局管理 · 全部项目：新建、编辑一句话项目记忆说明、复制 slug、归档/恢复与删除 */
export default function ProjectsPage() {
  const store = useVibeHub();
  const { user } = useAuth();
  const canEdit = useCanEdit();
  const toast = useToast();
  const router = useRouter();

  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  const createProject = async () => {
    if (!newName.trim()) return;
    try {
      await store.createProject(newName.trim(), undefined, newDesc.trim() || undefined);
      setNewName('');
      setNewDesc('');
      toast.success('项目已创建');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败');
    }
  };

  const copySlug = async (p: Project) => {
    await navigator.clipboard.writeText(p.slug);
    toast.success(`已复制 slug: ${p.slug}`);
  };

  const toggleArchive = async (p: Project) => {
    await api.updateProject(p.id, { archived_at: p.archived_at ? null : new Date().toISOString() });
    await store.refreshProjects();
    toast.success(p.archived_at ? '已恢复项目' : '已归档项目');
  };

  const saveDesc = async (p: Project) => {
    setEditingDescId(null);
    if (descDraft.trim() === (p.description ?? '').trim()) return;
    try {
      await api.updateProject(p.id, { description: descDraft.trim() || null });
      await store.refreshProjects();
      toast.success('项目一句话定位已保存');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        scope="global"
        title="全部项目管理"
        badge={store.projects.length}
        subtitle="每个项目独立隔离；AI 通过 slug 精准绑定对应仓库"
      />

      {isAdmin && (
        <div className="vh-ws-toolbar">
          <input
            className="vh-input-compact w-52"
            placeholder="新项目名称（必填）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void createProject()}
          />
          <input
            className="vh-input-compact min-w-[200px] flex-1"
            placeholder="一句话项目说明（可选，将作为项目记忆下发给 AI）"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void createProject()}
          />
          <button
            type="button"
            className="vh-btn h-8 px-3 text-xs"
            disabled={!newName.trim()}
            onClick={() => void createProject()}
          >
            <FolderPlus size={13} /> 创建项目
          </button>
        </div>
      )}

      <div className="vh-ws-scroll">
        <div className="vh-ws-container">
          {store.projects.length === 0 ? (
            <div className="vh-card">
              <div className="vh-empty">
                <span className="vh-empty-icon"><Package size={24} strokeWidth={1.6} /></span>
                <p className="vh-empty-title">还没有项目</p>
                <p className="vh-empty-hint">在上方输入名称创建第一个项目工作区</p>
              </div>
            </div>
          ) : (
            <div className="vh-list-surface overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm" data-testid="projects-table">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 text-left text-xs text-[var(--text-tertiary)]">
                    <th className="px-4 py-2.5 font-medium">项目名称与一句话定位</th>
                    <th className="px-3 py-2.5 font-medium">Slug（AI 匹配标识）</th>
                    <th className="px-3 py-2.5 font-medium">状态</th>
                    <th className="px-3 py-2.5 font-medium">创建于</th>
                    <th className="px-4 py-2.5 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {store.projects.map((p) => {
                    const archived = !!p.archived_at;
                    const isCurrent = store.currentProject?.id === p.id;
                    return (
                      <tr key={p.id} className="hover:bg-[var(--bg-elevated)]/50" data-testid="project-row">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="flex cursor-pointer items-center gap-1 font-medium text-[var(--text-primary)] hover:text-[var(--brand)]"
                              disabled={archived}
                              onClick={() => {
                                store.selectProject(p.id);
                                router.push('/today');
                              }}
                            >
                              {p.name}
                              {!archived && <ArrowUpRight size={13} className="opacity-60" />}
                            </button>
                            {isCurrent && (
                              <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--brand)]">
                                当前工作区
                              </span>
                            )}
                          </div>
                          {editingDescId === p.id ? (
                            <input
                              autoFocus
                              className="vh-input-compact mt-1 w-full max-w-md"
                              value={descDraft}
                              placeholder="补充一句话项目定位…"
                              onChange={(e) => setDescDraft(e.target.value)}
                              onBlur={() => void saveDesc(p)}
                              onKeyDown={(e) => e.key === 'Enter' && void saveDesc(p)}
                            />
                          ) : (
                            <button
                              type="button"
                              disabled={!canEdit}
                              className="mt-0.5 block cursor-pointer text-left text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                              onClick={() => {
                                setEditingDescId(p.id);
                                setDescDraft(p.description ?? '');
                              }}
                            >
                              {p.description || (canEdit ? '点击补充一句话项目说明…' : '暂无项目说明')}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded bg-[var(--bg-elevated)] px-2 py-1 font-mono text-xs text-[var(--text-secondary)] hover:text-[var(--brand)]"
                            onClick={() => void copySlug(p)}
                            title="点击复制"
                          >
                            {p.slug}
                            <Copy size={11} className="opacity-50" />
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          {archived ? (
                            <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs text-[var(--text-tertiary)]">已归档</span>
                          ) : (
                            <span className="rounded bg-[var(--ok)]/15 px-1.5 py-0.5 text-xs text-[var(--ok)]">活跃</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs text-[var(--text-tertiary)]">{p.created_at.slice(0, 10)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            {isAdmin && (
                              <button
                                type="button"
                                className="vh-btn ghost h-7 px-2 text-xs"
                                onClick={() => void toggleArchive(p)}
                                title={archived ? '恢复项目' : '归档项目'}
                              >
                                {archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                                {archived ? '恢复' : '归档'}
                              </button>
                            )}
                            {isAdmin && (
                              <button
                                type="button"
                                className="vh-btn ghost danger h-7 px-2 text-xs"
                                onClick={() => {
                                  setDeleteTarget(p);
                                  setDeleteConfirmText('');
                                }}
                                title="删除项目"
                              >
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
            </div>
          )}
        </div>
      </div>

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-[420px] max-w-[92vw] rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-panel)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-base font-semibold text-[var(--text-primary)]">删除项目「{deleteTarget.name}」</h3>
            <p className="mb-3 text-xs leading-relaxed text-[var(--text-secondary)]">
              将永久删除该项目下的全部缺陷、任务、随手记、专属技能与附件记录（磁盘附件移入回收站）。代码仓库本身不受影响。
            </p>
            <p className="mb-1.5 text-xs text-[var(--text-tertiary)]">
              请输入项目名 <code className="rounded bg-[var(--bg-elevated)] px-1">{deleteTarget.name}</code> 以确认：
            </p>
            <input
              autoFocus
              className="mb-4 h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 text-sm outline-none focus:border-[var(--danger)]"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="vh-btn ghost h-8 text-xs" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button
                type="button"
                className="vh-btn danger h-8 text-xs"
                disabled={deleteConfirmText !== deleteTarget.name}
                onClick={async () => {
                  await api.deleteProject(deleteTarget.id);
                  setDeleteTarget(null);
                  await store.refreshProjects();
                  toast.success(`已删除项目 ${deleteTarget.name}`);
                }}
              >
                <Trash2 size={13} /> 永久删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
