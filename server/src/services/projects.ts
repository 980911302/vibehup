import type { Project, Prisma } from '@prisma/client';
import path from 'node:path';
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
  // 未指定时尝试用当前工作目录名匹配 slug（AI 自动匹配，设计文档第 3 节）
  const cwdName = path.basename(process.cwd()).toLowerCase();
  if (cwdName) {
    const byCwd = await prisma.project.findFirst({
      where: { slug: { startsWith: cwdName } },
    });
    if (byCwd) return byCwd;
  }
  const fallback = await prisma.project.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (!fallback) throw new NotFoundError('系统中还没有任何项目，请先在 Web 端创建');
  return fallback;
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
