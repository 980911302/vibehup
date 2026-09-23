import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { NotFoundError, ValidationError } from '../core/errors.js';

/**
 * 保存的视图（Excel 式「我的筛选」：筛选+排序+列显隐按用户持久化）。
 */

export interface SavedViewView {
  id: string;
  user_id: string;
  entity: string;
  name: string;
  filters: Record<string, unknown>;
  sort: Record<string, unknown>;
  columns: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
}

const ENTITIES = ['bug', 'file', 'task'] as const;

function parseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function listViews(userId: string, entity?: string): Promise<SavedViewView[]> {
  const views = await prisma.savedView.findMany({
    where: { userId, ...(entity ? { entity } : {}) },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  return views.map((v) => ({
    id: v.id,
    user_id: v.userId,
    entity: v.entity,
    name: v.name,
    filters: parseJson(v.filters),
    sort: parseJson(v.sort),
    columns: parseJson(v.columns),
    is_default: v.isDefault,
    created_at: v.createdAt.toISOString(),
  }));
}

export async function createView(
  userId: string,
  input: {
    entity: string;
    name: string;
    filters?: Record<string, unknown>;
    sort?: Record<string, unknown>;
    columns?: Record<string, unknown>;
    is_default?: boolean;
  },
): Promise<SavedViewView> {
  if (!ENTITIES.includes(input.entity as never)) {
    throw new ValidationError(`entity 必须是 ${ENTITIES.join(' | ')} 之一`);
  }
  if (!input.name?.trim()) throw new ValidationError('视图名称不能为空');

  // 同名冲突按用户+实体唯一（schema @@unique）
  const clash = await prisma.savedView.findFirst({
    where: { userId, entity: input.entity, name: input.name.trim() },
  });
  if (clash) throw new ValidationError(`已存在同名视图: ${input.name}`);

  const isDefault = input.is_default ?? false;
  if (isDefault) {
    // 同实体下默认视图唯一
    await prisma.savedView.updateMany({
      where: { userId, entity: input.entity, isDefault: true },
      data: { isDefault: false },
    });
  }

  const v = await prisma.savedView.create({
    data: {
      id: ids.attachment(),
      userId,
      entity: input.entity,
      name: input.name.trim(),
      filters: JSON.stringify(input.filters ?? {}),
      sort: JSON.stringify(input.sort ?? {}),
      columns: JSON.stringify(input.columns ?? {}),
      isDefault,
    },
  });
  return {
    id: v.id,
    user_id: v.userId,
    entity: v.entity,
    name: v.name,
    filters: parseJson(v.filters),
    sort: parseJson(v.sort),
    columns: parseJson(v.columns),
    is_default: v.isDefault,
    created_at: v.createdAt.toISOString(),
  };
}

export async function updateView(
  userId: string,
  viewId: string,
  patch: { name?: string; filters?: Record<string, unknown>; sort?: Record<string, unknown>; columns?: Record<string, unknown>; is_default?: boolean },
): Promise<SavedViewView> {
  const existing = await prisma.savedView.findFirst({ where: { id: viewId, userId } });
  if (!existing) throw new NotFoundError(`视图不存在: ${viewId}`);

  if (patch.is_default) {
    await prisma.savedView.updateMany({
      where: { userId, entity: existing.entity, isDefault: true },
      data: { isDefault: false },
    });
  }

  const v = await prisma.savedView.update({
    where: { id: viewId },
    data: {
      name: patch.name?.trim() || existing.name,
      filters: patch.filters ? JSON.stringify(patch.filters) : existing.filters,
      sort: patch.sort ? JSON.stringify(patch.sort) : existing.sort,
      columns: patch.columns ? JSON.stringify(patch.columns) : existing.columns,
      isDefault: patch.is_default ?? existing.isDefault,
    },
  });
  return {
    id: v.id,
    user_id: v.userId,
    entity: v.entity,
    name: v.name,
    filters: parseJson(v.filters),
    sort: parseJson(v.sort),
    columns: parseJson(v.columns),
    is_default: v.isDefault,
    created_at: v.createdAt.toISOString(),
  };
}

export async function deleteView(userId: string, viewId: string): Promise<void> {
  const existing = await prisma.savedView.findFirst({ where: { id: viewId, userId } });
  if (!existing) throw new NotFoundError(`视图不存在: ${viewId}`);
  await prisma.savedView.delete({ where: { id: viewId } });
}
