import { prisma } from '../core/prisma.js';
import { buildSearchIndex, matchIndex } from '../core/search.js';
import { parseTags } from './notes.js';
import { isEmbeddingEnabled, similarEntities } from './embedding.js';
import {
  serializeAttachment,
  serializeBug,
  serializeNote,
  serializeProject,
  serializeTask,
} from '../core/serialize.js';

/**
 * 全局搜索（Web ⌘K 与 MCP search 工具共用）。
 * 从 routes/search.ts 上移至 service 层（架构契约：routes 禁直连 Prisma）。
 * similar 分区为语义近邻（卡片 28）：未启用或失败时为空数组，不影响关键词结果。
 */

export interface GlobalSearchResults {
  projects: ReturnType<typeof serializeProject>[];
  bugs: ReturnType<typeof serializeBug>[];
  tasks: ReturnType<typeof serializeTask>[];
  notes: ReturnType<typeof serializeNote>[];
  attachments: ReturnType<typeof serializeAttachment>[];
  similar: {
    bugs: ReturnType<typeof serializeBug>[];
    notes: ReturnType<typeof serializeNote>[];
  };
}

export async function globalSearch(q: string, limitPerType = 5): Promise<GlobalSearchResults> {
  if (!q.trim()) {
    return { projects: [], bugs: [], tasks: [], notes: [], attachments: [], similar: { bugs: [], notes: [] } };
  }

  const [projects, bugs, tasks, notes, attachments] = await Promise.all([
    prisma.project.findMany({ take: 200 }),
    prisma.bug.findMany({ take: 300, orderBy: { updatedAt: 'desc' } }),
    prisma.task.findMany({ take: 300, orderBy: { updatedAt: 'desc' } }),
    prisma.note.findMany({ take: 300, orderBy: { createdAt: 'desc' } }),
    prisma.attachment.findMany({ take: 300, orderBy: { createdAt: 'desc' } }),
  ]);

  const similar = { bugs: [] as ReturnType<typeof serializeBug>[], notes: [] as ReturnType<typeof serializeNote>[] };
  if (isEmbeddingEnabled()) {
    try {
      const hits = await similarEntities(q, ['bug', 'note'], limitPerType);
      const bugIds = hits.filter((h) => h.entityType === 'bug').map((h) => h.entityId);
      const noteIds = hits.filter((h) => h.entityType === 'note').map((h) => h.entityId);
      if (bugIds.length > 0) {
        const bugRows = await prisma.bug.findMany({ where: { id: { in: bugIds } } });
        const byId = new Map(bugRows.map((b) => [b.id, b]));
        similar.bugs = bugIds
          .map((id) => byId.get(id))
          .filter((b): b is NonNullable<typeof b> => b !== undefined)
          .map(serializeBug);
      }
      if (noteIds.length > 0) {
        const noteRows = await prisma.note.findMany({ where: { id: { in: noteIds } } });
        const byId = new Map(noteRows.map((n) => [n.id, n]));
        similar.notes = noteIds
          .map((id) => byId.get(id))
          .filter((n): n is NonNullable<typeof n> => n !== undefined)
          .map((n) => serializeNote({ ...n, tagList: parseTags(n.tags) }));
      }
    } catch {
      // 语义检索失败（网络/配额）降级纯关键词，不污染关键词结果
    }
  }

  return {
    projects: projects
      .filter((p) => matchIndex(q, buildSearchIndex(p.name, `${p.slug} ${p.description ?? ''}`)))
      .slice(0, limitPerType)
      .map((p) => serializeProject(p)),
    bugs: bugs
      .filter((b) => matchIndex(q, buildSearchIndex(b.title, `${b.actualResult ?? ''} ${b.stepsToReproduce ?? ''}`)))
      .slice(0, limitPerType)
      .map(serializeBug),
    tasks: tasks
      .filter((t) => matchIndex(q, buildSearchIndex(t.title, t.description ?? '')))
      .slice(0, limitPerType)
      .map((t) => serializeTask(t)),
    notes: notes
      .filter((n) => matchIndex(q, buildSearchIndex(n.content.slice(0, 40), `${n.content} ${parseTags(n.tags).join(' ')}`)))
      .slice(0, limitPerType)
      .map((n) => serializeNote({ ...n, tagList: parseTags(n.tags) })),
    attachments: attachments
      .filter((a) => matchIndex(q, buildSearchIndex(a.fileName)))
      .slice(0, limitPerType)
      .map(serializeAttachment),
    similar,
  };
}
