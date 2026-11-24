'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderPlus, Puzzle, Search, Settings2, Upload } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useCanEdit } from '@/lib/auth';
import { api } from '@/lib/api';
import type { Skill } from '@/lib/api-types';
import { buildSearchIndex, matchIndex } from '@/lib/search';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { SkillCard } from '@/components/skills/SkillCard';
import { SkillDetailDialog } from '@/components/skills/SkillDetailDialog';
import { SkillUploadDialog } from '@/components/skills/SkillUploadDialog';

/** 项目专属技能页：严格只展示当前项目挂载的技能；通用技能移入全局设置管理 */
export default function SkillsPage() {
  const store = useVibeHub();
  const router = useRouter();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const canEdit = useCanEdit();
  const projectId = store.currentProject?.id;

  const load = useCallback(async () => {
    if (!projectId) {
      setSkills([]);
      return;
    }
    try {
      // includeGlobal=false：严格只读取当前项目专属技能，不混入跨项目/全局技能
      setSkills(await api.listSkills(projectId, false));
    } catch {
      // 忽略
    }
  }, [projectId]);

  useEffect(() => {
    setSkills([]);
    setDetailId(null);
    void load();
  }, [projectId, load, store.skillRevision]);

  const visible = useMemo(() => {
    if (!query.trim()) return skills;
    return skills.filter((s) => matchIndex(query, buildSearchIndex(s.name, s.description)));
  }, [skills, query]);

  if (!store.loading && !store.currentProject) {
    return (
      <div className="flex h-full flex-col">
        <WorkspaceHeader title="技能" />
        <div className="vh-empty flex-1">
          <span className="vh-empty-icon"><Puzzle size={24} strokeWidth={1.6} /></span>
          <p className="vh-empty-title">还没有项目</p>
          <p className="vh-empty-hint">项目技能严格绑定当前项目工作区；先创建第一个项目</p>
          <button
            type="button"
            className="vh-btn h-8 text-xs"
            onClick={() => window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'))}
          >
            <FolderPlus size={14} /> 创建第一个项目
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        title="技能"
        badge={visible.length}
        subtitle="仅限当前项目专属技能"
        actions={
          <>
            <button
              type="button"
              className="vh-btn ghost h-8 px-2.5 text-xs"
              onClick={() => router.push('/settings')}
              title="前往全局设置管理团队通用技能"
            >
              <Settings2 size={13} />
              <span className="hidden sm:inline">通用技能库</span>
            </button>
            {canEdit && (
              <button type="button" className="vh-btn h-8 px-2.5 text-xs" onClick={() => setUploading(true)} data-testid="skill-upload-open">
                <Upload size={13} />
                上传技能
              </button>
            )}
          </>
        }
      />

      <div className="vh-ws-toolbar">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            className="vh-input-compact w-52 pl-7"
            placeholder="搜索本项目技能"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="ml-auto hidden text-xs text-[var(--text-tertiary)] md:inline">
          仅展示「{store.currentProject?.name}」专属技能，跨项目通用技能已隔离至全局设置
        </span>
      </div>

      <div className="vh-ws-scroll">
        <div className="vh-ws-container">
          {visible.length === 0 ? (
            <div className="vh-empty">
              <span className="vh-empty-icon"><Puzzle size={24} strokeWidth={1.6} /></span>
              <p className="vh-empty-title">{skills.length > 0 ? '没有匹配的项目技能' : '当前项目还没有专属技能'}</p>
              <p className="vh-empty-hint">
                上传含 SKILL.md 的目录或 zip 包后，AI 在连接本项目时可通过 MCP 按需读取和下载执行。
              </p>
              {canEdit && skills.length === 0 && (
                <button type="button" className="vh-btn h-8 text-xs" onClick={() => setUploading(true)}>
                  <Upload size={13} /> 上传项目技能
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {visible.map((s) => (
                <SkillCard
                  key={s.id}
                  skill={s}
                  projectName={store.currentProject?.name ?? null}
                  onOpen={() => setDetailId(s.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {uploading && store.currentProject && (
        <SkillUploadDialog
          currentProject={store.currentProject}
          mode="project"
          onClose={() => setUploading(false)}
          onUploaded={(s) => {
            setUploading(false);
            void load();
            setDetailId(s.id);
          }}
        />
      )}
      {detailId && (
        <SkillDetailDialog
          skillId={detailId}
          canEdit={canEdit}
          projects={store.projects}
          onClose={() => setDetailId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
