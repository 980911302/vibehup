import { prisma } from '../core/prisma.js';
import { ids } from '../core/ids.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../core/errors.js';

/**
 * 缺陷模板（步骤 04 §4.3）。
 * 新团队首次访问惰性创建三个默认模板——不预置数据、不产生 seed。
 */

export interface BugTemplateView {
  id: string;
  name: string;
  title_template: string;
  fields: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

const DEFAULT_TEMPLATES = [
  {
    name: '缺陷报告',
    titleTemplate: '[{module}] {简述}',
    fields: { severity: 'normal', labels: ['bug'], steps_to_reproduce: '1. \n2. \n3. ' },
  },
  {
    name: '需求跟进',
    titleTemplate: '[需求] {简述}',
    fields: { severity: 'low', labels: ['requirement'], steps_to_reproduce: '背景：\n期望：' },
  },
  {
    name: '线上事故',
    titleTemplate: '[P{level}] {简述}',
    fields: {
      severity: 'critical',
      labels: ['incident'],
      steps_to_reproduce:
        '发现时间：\n影响范围：\n时间线：\n  1. \n缓解措施：\n',
    },
  },
];

function parseFields(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toView(t: {
  id: string;
  name: string;
  titleTemplate: string;
  fields: string;
  createdBy: string | null;
  createdAt: Date;
}): BugTemplateView {
  return {
    id: t.id,
    name: t.name,
    title_template: t.titleTemplate,
    fields: parseFields(t.fields),
    created_by: t.createdBy,
    created_at: t.createdAt.toISOString(),
  };
}

/** 单个模板（新建缺陷弹层的模板填充用） */
export async function getTemplate(templateId: string): Promise<BugTemplateView | null> {
  const t = await prisma.bugTemplate.findUnique({ where: { id: templateId } });
  return t ? toView(t) : null;
}

/** 列表：空库时惰性创建三个默认模板（幂等） */
export async function listTemplates(): Promise<BugTemplateView[]> {
  const count = await prisma.bugTemplate.count();
  if (count === 0) {
    await prisma.bugTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((t) => ({
        id: ids.attachment(),
        name: t.name,
        titleTemplate: t.titleTemplate,
        fields: JSON.stringify(t.fields),
        createdBy: null,
      })),
    });
  }
  const templates = await prisma.bugTemplate.findMany({ orderBy: { createdAt: 'asc' } });
  return templates.map(toView);
}

export async function createTemplate(input: {
  name: string;
  titleTemplate: string;
  fields?: Record<string, unknown>;
  createdBy?: string | null;
}): Promise<BugTemplateView> {
  if (!input.name?.trim()) throw new ValidationError('模板名称不能为空');
  if (!input.titleTemplate?.trim()) throw new ValidationError('标题模板不能为空');
  const t = await prisma.bugTemplate.create({
    data: {
      id: ids.attachment(),
      name: input.name.trim(),
      titleTemplate: input.titleTemplate,
      fields: JSON.stringify(input.fields ?? {}),
      createdBy: input.createdBy ?? null,
    },
  });
  return toView(t);
}

export async function updateTemplate(
  templateId: string,
  patch: { name?: string; titleTemplate?: string; fields?: Record<string, unknown> },
): Promise<BugTemplateView> {
  const existing = await prisma.bugTemplate.findUnique({ where: { id: templateId } });
  if (!existing) throw new NotFoundError(`模板不存在: ${templateId}`);
  const t = await prisma.bugTemplate.update({
    where: { id: templateId },
    data: {
      name: patch.name?.trim() || existing.name,
      titleTemplate: patch.titleTemplate?.trim() || existing.titleTemplate,
      fields: patch.fields ? JSON.stringify(patch.fields) : existing.fields,
    },
  });
  return toView(t);
}

export async function deleteTemplate(templateId: string): Promise<void> {
  const existing = await prisma.bugTemplate.findUnique({ where: { id: templateId } });
  if (!existing) throw new NotFoundError(`模板不存在: ${templateId}`);
  await prisma.bugTemplate.delete({ where: { id: templateId } });
}

/** 模板管理权限校验（Member 可用不可改，Admin+ 可管理） */
export function assertTemplateManageable(role: string): void {
  if (!['owner', 'admin'].includes(role)) {
    throw new ForbiddenError('只有管理员可以管理模板');
  }
}
