'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, Puzzle, Search, Upload } from 'lucide-react';
import { useVibeHub } from '@/hooks/use-vibehub';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import type { Skill } from '@/lib/api-types';
import { buildSearchIndex, matchIndex } from '@/lib/search';
import { CurrentProjectSwitcher } from '@/components/layout/CurrentProjectSwitcher';
import { SkillCard } from '@/components/skills/SkillCard';
import { SkillDetailDialog } from '@/components/skills/SkillDetailDialog';
import { SkillUploadDialog } from '@/components/skills/SkillUploadDialog';

type ScopeFilter = 'all' | 'project' | 'global';
const SCOPE_TABS: { key: ScopeFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'project', label: '本项目' },
  { key: 'global', label: '通用' },
];

/** 技能页：当前项目的技能 + 全团队通用技能；上传、查看、下载、调整归属、删除 */
export default function SkillsPage() {
  const store = useVibeHub();
  const { user } = useAuth();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const canEdit = user?.role !== 'viewer';
  const projectId = store.currentProject?.id;

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setSkills(await api.listSkills(projectId));
    } catch {
      // 忽略：保留旧列表
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, store.skillRevision]);

  const visible = useMemo(() => {
    let list = scope === 'all' ? skills : skills.filter((s) => s.scope === scope);
    if (query.trim()) list = list.filter((s) => matchIndex(query, buildSearchIndex(s.name, s.description)));
    return list;
  }, [skills, scope, query]);

  if (!store.currentProject) return <NoProject />;
  const projectNames = new Map(store.projects.map((p) => [p.id, p.name]));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
        <CurrentProjectSwitcher />
        <div className="flex gap-1 rounded-lg bg-[var(--bg-elevated)] p-0.5">
          {SCOPE_TABS.map((t) => (
            <button
              key={t.key}
              className={`cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors ${scope === t.key ? 'bg-[var(--bg-page)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)]'}`}
              onClick={() => setScope(t.key)}
              data-testid={`skills-tab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            className="h-8 w-44 rounded-md border border-[var(--border-strong)] bg-[var(--bg-page)] pl-7 pr-2 text-xs outline-none focus:border-[var(--brand)]"
            placeholder="搜索技能"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="text-xs text-[var(--text-tertiary)]">{visible.length} 个技能</span>
        <div className="flex-1" />
        {canEdit && (
          <button className="vh-btn" onClick={() => setUploading(true)} data-testid="skill-upload-open">
            <Upload size={14} />
            上传技能
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {visible.length === 0 ? (
          <EmptySkills canEdit={canEdit} filtered={skills.length > 0} onUpload={() => setUploading(true)} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {visible.map((s) => (
              <SkillCard key={s.id} skill={s} projectName={s.project_id ? projectNames.get(s.project_id) ?? null : null} onOpen={() => setDetailId(s.id)} />
            ))}
          </div>
        )}
      </div>

      {uploading && (
        <SkillUploadDialog
          currentProject={store.currentProject}
          onClose={() => setUploading(false)}
          onUploaded={(s) => {
            setUploading(false);
            void load();
            setDetailId(s.id);
          }}
        />
      )}
      {detailId && (
        <SkillDetailDialog skillId={detailId} canEdit={canEdit} projects={store.projects} onClose={() => setDetailId(null)} onChanged={() => void load()} />
      )}
    </div>
  );
}

function EmptySkills({ canEdit, filtered, onUpload }: { canEdit: boolean; filtered: boolean; onUpload: () => void }) {
  return (
    <div className="vh-empty" style={{ height: '100%' }}>
      <span className="vh-empty-icon"><Puzzle size={28} strokeWidth={1.6} /></span>
      <p className="vh-empty-title">{filtered ? '没有符合条件的技能' : '还没有技能'}</p>
      <p className="vh-empty-hint">
        技能就是 Claude Code 的 skill（SKILL.md + 附带文件）。上传后，IDE 里的 AI 能通过 MCP 查看描述、按需下载到 .claude/skills/，也能把自己总结的技能传上来。
      </p>
      {canEdit && !filtered && (
        <button className="vh-btn" onClick={onUpload}>
          <Upload size={14} />
          上传第一个技能
        </button>
      )}
    </div>
  );
}

function NoProject() {
  return (
    <div className="vh-empty" style={{ height: '100%' }}>
      <span className="vh-empty-icon"><Puzzle size={28} strokeWidth={1.6} /></span>
      <p className="vh-empty-title">还没有项目</p>
      <p className="vh-empty-hint">技能可以挂在项目下，也可以设为全团队通用；先建一个项目</p>
      <button className="vh-btn" onClick={() => window.dispatchEvent(new CustomEvent('vibehub:open-onboarding'))}>
        <FolderPlus size={14} />
        创建第一个项目
      </button>
    </div>
  );
}
