import type { Project, Prisma } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { ids, slugify } from '../core/ids.js';
import { buildSearchIndex, matchIndex } from '../core/search.js';
import { NotFoundError, ValidationError } from '../core/errors.js';

export interface ProjectWithCounts extends Project {
  openBugCount: number;
  todoTaskCount: number;
  attachmentCount: number;
}

export async function createProject(input: {
  name: string;
  slug?: string;
  description?: string | null;
}): Promise<Project> {
  let slug = input.slug?.trim() || slugify(input.name);
  // 保证 slug 唯一
  const existing = await prisma.project.findUnique({ where: { slug } });
  if (existing) {
    const suffix = Math.random().toString(36).slice(2, 6);
    slug = `${slug}-${suffix}`;
  }
  return prisma.project.create({
    data: {
      id: ids.project(),
      name: input.name,
      slug,
      description: input.description ?? null,
    },
  });
}

export async function updateProject(
  projectId: string,
  patch: { name?: string; slug?: string; description?: string | null; archived_at?: string | null },
): Promise<Project> {
  await getProject(projectId);
  if (patch.slug) {
    const clash = await prisma.project.findUnique({ where: { slug: patch.slug } });
    if (clash && clash.id !== projectId) throw new ValidationError(`slug 已被占用: ${patch.slug}`);
  }
  const data: Prisma.ProjectUncheckedUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.slug !== undefined) data.slug = patch.slug;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.archived_at !== undefined) {
    data.archivedAt = patch.archived_at === null ? null : new Date(patch.archived_at);
  }
  return prisma.project.update({ where: { id: projectId }, data });
}

export async function getProject(projectId: string): Promise<Project> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError(`项目不存在: ${projectId}`);
  return project;
}

export async function getProjectBySlug(slug: string): Promise<Project> {
  const project = await prisma.project.findUnique({ where: { slug } });
  if (!project) throw new NotFoundError(`项目不存在(slug): ${slug}`);
  return project;
}

/** 歧义报错时最多列出的候选项目数（Token 经济学） */
const AMBIGUOUS_LIST_LIMIT = 20;

/** 按 ID 或 slug 解析项目（MCP 侧常用） */
export async function resolveProject(projectSlugOrId?: string): Promise<Project> {
  if (projectSlugOrId?.trim()) {
    const key = projectSlugOrId.trim();
    const bySlug = await prisma.project.findUnique({ where: { slug: key } });
    if (bySlug) return bySlug;
    const byId = await prisma.project.findUnique({ where: { id: key } });
    if (byId) return byId;
    throw new NotFoundError(`项目不存在: ${key}`);
  }
  // 未指定（R76）：仅当只有一个进行中的项目时自动选择。
  // 不再按 cwd 猜、不再静默回落到最近更新的项目——这里的 cwd 是 MCP 服务进程自己的
  // （容器内为 /app），与 IDE 工作区无关，猜错会让 AI 的写入悄悄落进别的项目。
  const active = await prisma.project.findMany({
    where: { archivedAt: null },
    orderBy: { updatedAt: 'desc' },
    take: AMBIGUOUS_LIST_LIMIT + 1,
  });
  if (active.length === 1) return active[0];
  if (active.length === 0) {
    throw new NotFoundError('系统中还没有进行中的项目，请先在 Web 端创建（或取消归档）');
  }
  const options = active
    .slice(0, AMBIGUOUS_LIST_LIMIT)
    .map((p) => `${p.slug}（${p.name}）`)
    .join('、');
  const more = active.length > AMBIGUOUS_LIST_LIMIT ? ' 等' : '';
  throw new ValidationError(
    `未指定 project_slug，且有多个进行中的项目，无法确定要操作哪一个。请传 project_slug，可选：${options}${more}`,
  );
}


/** 项目列表：支持中文/拼音模糊检索 */
export async function listProjects(query: { q?: string } = {}): Promise<ProjectWithCounts[]> {
  const projects = await prisma.project.findMany({ orderBy: { updatedAt: 'desc' } });

  let filtered = projects;
  if (query.q?.trim()) {
    const q = query.q.trim();
    filtered = projects.filter((p) =>
      matchIndex(q, buildSearchIndex(p.name, `${p.slug} ${p.description ?? ''}`)),
    );
  }

  return Promise.all(
    filtered.map(async (p) => {
      const [openBugCount, todoTaskCount, attachmentCount] = await Promise.all([
        prisma.bug.count({ where: { projectId: p.id, status: { in: ['open', 'in_progress'] } } }),
        prisma.task.count({ where: { projectId: p.id, status: { not: 'done' } } }),
        prisma.attachment.count({ where: { projectId: p.id } }),
      ]);
      return { ...p, openBugCount, todoTaskCount, attachmentCount };
    }),
  );
}

export async function deleteProject(projectId: string): Promise<void> {
  await getProject(projectId);
  // 级联删除附件物理文件
  const attachments = await prisma.attachment.findMany({ where: { projectId } });
  const { storage } = await import('./storage.js');
  for (const a of attachments) {
    await storage.delete(a.storagePath).catch(() => undefined);
  }
  await prisma.project.delete({ where: { id: projectId } });
}
