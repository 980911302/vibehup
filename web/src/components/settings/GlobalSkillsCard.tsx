'use client';

import { useCallback, useEffect, useState } from 'react';
import { Puzzle, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useCanEdit } from '@/lib/auth';
import { useVibeHub } from '@/hooks/use-vibehub';
import type { Skill } from '@/lib/api-types';
import { SkillCard } from '@/components/skills/SkillCard';
import { SkillDetailDialog } from '@/components/skills/SkillDetailDialog';
import { SkillUploadDialog } from '@/components/skills/SkillUploadDialog';

/** 全局设置中的团队通用技能库：不与单个项目的专属技能混排 */
export function GlobalSkillsCard() {
  const store = useVibeHub();
  const canEdit = useCanEdit();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [uploading, setUploading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await api.listSkills();
      setSkills(all.filter((s) => s.scope === 'global' || !s.project_id));
    } catch {
      // 忽略
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, store.skillRevision]);

  return (
    <section className="vh-card p-5 lg:col-span-2" data-testid="global-skills-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Puzzle size={15} className="text-[var(--gold)]" />
            团队通用技能库（{skills.length}）
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
            跨项目共享的基础技能集中在此维护；单个项目的「技能」模块仅展示该项目专属技能，保持工作区干净隔离。
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            className="vh-btn ghost h-8 px-2.5 text-xs"
            onClick={() => setUploading(true)}
            data-testid="global-skill-upload-open"
          >
            <Upload size={13} /> 上传通用技能
          </button>
        )}
      </div>

      {skills.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-[var(--border-subtle)] px-4 py-6 text-center text-xs text-[var(--text-tertiary)]">
          暂无跨项目通用技能
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {skills.map((s) => (
            <SkillCard key={s.id} skill={s} projectName={null} onOpen={() => setDetailId(s.id)} />
          ))}
        </div>
      )}

      {uploading && (
        <SkillUploadDialog
          currentProject={store.currentProject}
          mode="global"
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
    </section>
  );
}
