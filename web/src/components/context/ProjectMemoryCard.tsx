'use client';

import { useEffect, useState } from 'react';
import { Brain, Pin } from 'lucide-react';
import { api } from '@/lib/api';
import { useVibeHub } from '@/hooks/use-vibehub';
import type { ProjectMemory } from '@/lib/api-types';

/** 项目记忆（R90）：项目一句话 + 置顶笔记；给人和 AI 同一份压缩上下文。 */
export function ProjectMemoryCard() {
  const store = useVibeHub();
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const projectId = store.currentProject?.id;

  useEffect(() => {
    if (!projectId) {
      setMemory(null);
      return;
    }
    let cancelled = false;
    api
      .getProjectMemory(projectId)
      .then((m) => !cancelled && setMemory(m))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId || !memory) return null;
  const description = memory.project.description?.trim();
  // 空项目不额外占一条；有描述或决策时才显示
  if (!description && memory.decisions.length === 0) return null;

  return (
    <section
      className="mt-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3.5 py-2"
      data-testid="project-memory"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="t-caption-4 flex shrink-0 items-center gap-1.5 text-[var(--text-secondary)]">
          <Brain size={13} className="text-[var(--accent-color)]" /> 项目记忆
          <span className="t-caption-5 text-[var(--text-tertiary)]">{memory.decisions.length} 条决策</span>
        </p>
        <p className="t-caption-2 min-w-[180px] flex-1 truncate text-[var(--text-secondary)]">
          {description || '在项目设置里补一句项目是做什么的；置顶重要笔记会进这里。'}
        </p>
        {memory.decisions.slice(0, 3).map((d) => (
          <span
            key={d.id}
            className="t-caption-5 inline-flex max-w-[260px] shrink-0 items-center gap-1 rounded bg-[var(--bg-elevated)] px-2 py-0.5 text-[var(--text-tertiary)]"
          >
            <Pin size={10} className="shrink-0" />
            <span className="truncate">{d.content}</span>
          </span>
        ))}
      </div>
    </section>
  );
}
