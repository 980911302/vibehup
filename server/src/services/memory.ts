import { NotFoundError } from '../core/errors.js';
import { prisma } from '../core/prisma.js';

/**
 * 项目记忆（R90）：不新建仓库，只把「项目一句话 + 置顶笔记（决策）」压缩给人和 AI。
 * 置顶 = 决策；取消置顶即移出记忆。向量不开启也能用。
 */
export async function getProjectMemory(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, slug: true, description: true, updatedAt: true },
  });
  if (!project) throw new NotFoundError(`项目不存在: ${projectId}`);
  const notes = await prisma.note.findMany({
    where: { projectId, pinnedAt: { not: null }, isArchived: false },
    orderBy: { pinnedAt: 'desc' },
    take: 5,
    select: { id: true, content: true, tags: true, pinnedAt: true, updatedAt: true },
  });
  return {
    project: { id: project.id, name: project.name, slug: project.slug, description: project.description },
    decisions: notes.map((n) => ({
      id: n.id,
      content: n.content,
      tags: n.tags,
      pinned_at: n.pinnedAt?.toISOString() ?? null,
      updated_at: n.updatedAt.toISOString(),
    })),
    updated_at: project.updatedAt.toISOString(),
  };
}

/** 给 MCP 的压缩版：最多 3 条决策、每条 300 字，避免上下文膨胀。 */
export async function getProjectMemoryForMcp(projectId: string) {
  const memory = await getProjectMemory(projectId);
  return {
    project: memory.project,
    decisions: memory.decisions.slice(0, 3).map((d) => ({
      id: d.id,
      content: d.content.length > 300 ? `${d.content.slice(0, 300)}…` : d.content,
      tags: d.tags,
    })),
    note: '项目记忆来自置顶笔记；需要更多用 list_notes 或 search。',
  };
}
