'use client';

import { useEffect, useState } from 'react';
import { Brain, Pin } from 'lucide-react';
import { api } from '@/lib/api';
import { useVibeHub } from '@/hooks/use-vibehub';
import type { ProjectMemory } from '@/lib/api-types';

/** 项目记忆条：展示当前项目一句话定位 + 置顶决策笔记（随笔记变化实时刷新） */
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
  }, [projectId, store.notes]);

  if (!projectId || !memory) return null;
  const description = memory.project.description?.trim();
  if (!description && memory.decisions.length === 0) return null;

  return (
    <section
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]/40 px-5 py-2"
      data-testid="project-memory"
    >
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
        <Brain size={13} className="text-[var(--gold)]" />
        项目记忆
        <span className="text-[11px] font-normal text-[var(--text-tertiary)]">
          （MCP 自动下发给 AI · {memory.decisions.length} 条置顶）
        </span>
      </span>
      {description && (
        <span className="min-w-[160px] flex-1 truncate text-xs text-[var(--text-secondary)]">{description}</span>
      )}
      {memory.decisions.slice(0, 3).map((d) => (
        <span
          key={d.id}
          className="inline-flex max-w-[240px] shrink-0 items-center gap-1 rounded bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-tertiary)]"
        >
          <Pin size={10} className="shrink-0 text-[var(--gold)]" />
          <span className="truncate">{d.content}</span>
        </span>
      ))}
    </section>
  );
}
