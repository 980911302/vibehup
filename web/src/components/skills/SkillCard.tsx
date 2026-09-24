'use client';

import { FileCode2, Globe2, Sparkles } from 'lucide-react';
import type { Skill } from '@/lib/api-types';
import { formatSize } from '@/lib/skill-files';

interface SkillCardProps {
  skill: Skill;
  /** 挂在项目下时显示项目名；通用技能为 null */
  projectName: string | null;
  onOpen: () => void;
}

/** 技能卡片：名称、范围、描述、文件数与大小 */
export function SkillCard({ skill, projectName, onOpen }: SkillCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`skill-card-${skill.name}`}
      className="flex h-full w-full cursor-pointer flex-col gap-2 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5 text-left transition-colors hover:border-[var(--border-strong)]"
    >
      <div className="flex items-center gap-2">
        <FileCode2 size={15} className="shrink-0 text-[var(--brand)]" />
        <span className="flex-1 truncate font-mono text-[13px] font-medium text-[var(--text-primary)]">{skill.name}</span>
        {skill.source === 'ai' && (
          <span className="vh-ai-badge" title="由 AI 经 MCP 上传"><Sparkles size={9} strokeWidth={2.4} />AI</span>
        )}
      </div>
      <p className="line-clamp-3 flex-1 text-xs leading-relaxed text-[var(--text-secondary)]">{skill.description}</p>
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
        {skill.scope === 'global' ? (
          <span className="flex items-center gap-1 rounded bg-[var(--gold-bg)] px-1.5 py-0.5 text-[var(--gold)]"><Globe2 size={10} />全团队通用</span>
        ) : (
          <span className="truncate rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{projectName ?? '项目'}</span>
        )}
        <span>{skill.file_count === 0 ? '仅 SKILL.md' : `SKILL.md + ${skill.file_count} 个附带文件 · ${formatSize(skill.size)}`}</span>
        <span className="ml-auto">{skill.updated_at.slice(0, 10)}</span>
      </div>
    </button>
  );
}
