import type { Bug, Prisma } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { ids, slugify } from '../core/ids.js';
import { buildSearchIndex, matchIndex } from '../core/search.js';
import { eventBus } from '../core/events.js';
import { NotFoundError, ValidationError } from '../core/errors.js';
import { countAttachmentsFor } from './attachments.js';
import { upsertEntityEmbedding, deleteEntityEmbedding } from './embedding.js';
import { BUG_STATUSES, assertTransition, bugStatusLabel as label, isBugReopen, reopenReasonLabel, type BugStatus } from './bug-flow.js';
import { resolveStatusActor, type StatusActor } from './stale.js';

// 状态机迁到 bug-flow.ts（R83 加「验证中」后本文件超长），这里重导出保持既有引用不变
export * from './bug-flow.js';

export const BUG_SEVERITIES = ['low', 'normal', 'high', 'critical'] as const;
export const BUG_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

/** 负责人与提出人（只取 id + 名字），看板/列表/详情统一带上 */
const WITH_PEOPLE = {
  assignee: { select: { id: true, name: true } },
  reporter: { select: { id: true, name: true } },
} as const;

type Person = { id: string; name: string } | null;

export interface BugListQuery {
  projectId?: string;
  status?: string;
  severity?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface BugListResult {
  items: BugWithMeta[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BugWithMeta extends Bug {
  attachmentCount: number;
}

export async function createBug(input: {
  projectId: string;
  title: string;
  stepsToReproduce?: string | null;
  expectedResult?: string | null;
  actualResult?: string | null;
  severity?: string;
  priority?: string;
  assigneeId?: string | null;
  dueDate?: Date | string | null;
  labels?: string[];
  createdBy?: string;
  /** 提出人（用户 id）：网页录入=当前用户，MCP 建单=密钥创建人 */
  reporterId?: string | null;
  attachmentIds?: string[];
  /** 建单的操作人（记为初始状态的「谁」） */
  actor?: StatusActor;
}): Promise<Bug> {
  if (input.severity && !BUG_SEVERITIES.includes(input.severity as never)) {
    throw new ValidationError(`severity 必须是 ${BUG_SEVERITIES.join(' | ')} 之一`);
  }
  if (input.priority && !BUG_PRIORITIES.includes(input.priority as never)) {
    throw new ValidationError(`priority 必须是 ${BUG_PRIORITIES.join(' | ')} 之一`);
  }
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new NotFoundError(`项目不存在: ${input.projectId}`);

  const bug = await prisma.bug.create({
    data: {
      id: ids.bug(),
      projectId: input.projectId,
      title: input.title,
      stepsToReproduce: input.stepsToReproduce ?? null,
      expectedResult: input.expectedResult ?? null,
      actualResult: input.actualResult ?? null,
      severity: input.severity ?? 'normal',
      priority: input.priority ?? 'medium',
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      labels: input.labels ?? [],
      createdBy: input.createdBy ?? 'human',
      reporterId: input.reporterId ?? null,
      statusChangedAt: new Date(),
      ...(await resolveStatusActor(input.actor)),
    } as Prisma.BugUncheckedCreateInput,
    include: WITH_PEOPLE,
  });

  // 关联上传时返回的附件
  if (input.attachmentIds?.length) {
    await prisma.attachment.updateMany({
      where: { id: { in: input.attachmentIds }, entityType: 'general' },
      data: { entityType: 'bug', entityId: bug.id },
    });
  }

  eventBus.publish({ type: 'bug.created', projectId: bug.projectId, bugId: bug.id });
  await upsertEntityEmbedding('bug', bug.id, bugEmbeddingText(bug));
  return bug;
}

/** 缺陷向量化文本：标题 + 复现步骤 + 期望/实际（截断由 embedding 服务统一处理） */
function bugEmbeddingText(bug: { title: string; stepsToReproduce?: string | null; expectedResult?: string | null; actualResult?: string | null }): string {
  return [bug.title, bug.stepsToReproduce, bug.expectedResult, bug.actualResult]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join('\n');
}

export async function updateBug(
  bugId: string,
  patch: {
    title?: string;
    stepsToReproduce?: string | null;
    expectedResult?: string | null;
    actualResult?: string | null;
    severity?: string;
    status?: string;
    priority?: string;
    assigneeId?: string | null;
    dueDate?: Date | string | null;
    labels?: string[];
    resolutionNotes?: string | null;
    gitCommitHash?: string | null;
    createdBy?: string;
    /** 重开原因（回流到 open/in_progress 时必填） */
    reopenReason?: string;
    /** 操作者：写活动流 + 记「谁在处理」（user=人类取名字, ai=MCP 取密钥名） */
    actor?: StatusActor;
  },
): Promise<Bug> {
  const existing = await prisma.bug.findUnique({ where: { id: bugId } });
  if (!existing) throw new NotFoundError(`缺陷不存在: ${bugId}`);
  if (patch.status && !BUG_STATUSES.includes(patch.status as never)) {
    throw new ValidationError(`status 必须是 ${BUG_STATUSES.join(' | ')} 之一`);
  }
  if (patch.severity && !BUG_SEVERITIES.includes(patch.severity as never)) {
    throw new ValidationError(`severity 必须是 ${BUG_SEVERITIES.join(' | ')} 之一`);
  }
  if (patch.priority && !BUG_PRIORITIES.includes(patch.priority as never)) {
    throw new ValidationError(`priority 必须是 ${BUG_PRIORITIES.join(' | ')} 之一`);
  }

  // 状态机校验（仅在实际变更状态时）
  const statusChanged = patch.status !== undefined && patch.status !== existing.status;
  if (statusChanged) {
    assertTransition(existing.status as BugStatus, patch.status as BugStatus, {
      reopenReason: Boolean(patch.reopenReason?.trim()),
      closeReason: Boolean(patch.resolutionNotes?.trim()),
    });
  }

  const isReopen = statusChanged && isBugReopen(existing.status, patch.status as string);

  const data: Prisma.BugUncheckedUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.stepsToReproduce !== undefined) data.stepsToReproduce = patch.stepsToReproduce;
  if (patch.expectedResult !== undefined) data.expectedResult = patch.expectedResult;
  if (patch.actualResult !== undefined) data.actualResult = patch.actualResult;
  if (patch.severity !== undefined) data.severity = patch.severity;
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.assigneeId !== undefined) data.assigneeId = patch.assigneeId;
  if (patch.dueDate !== undefined) data.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
  if (patch.labels !== undefined) data.labels = patch.labels;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.resolutionNotes !== undefined) data.resolutionNotes = patch.resolutionNotes;
  if (patch.gitCommitHash !== undefined) data.gitCommitHash = patch.gitCommitHash;
  if (patch.createdBy !== undefined) data.createdBy = patch.createdBy;
  if (isReopen) data.reopenedCount = existing.reopenedCount + 1;
  if (statusChanged) {
    data.statusChangedAt = new Date();
    Object.assign(data, await resolveStatusActor(patch.actor));
  }

  const bug = await prisma.bug.update({ where: { id: bugId }, data, include: WITH_PEOPLE });

  // 状态变化自动写活动流（闭环①留痕）
  if (statusChanged) {
    const parts = [`状态变更：${label(existing.status)} → ${label(patch.status as string)}`];
    if (isReopen && patch.reopenReason) parts.push(`${reopenReasonLabel(existing.status)}：${patch.reopenReason.trim()}`);
    if (patch.resolutionNotes) parts.push(`${patch.status === 'closed' ? '关闭原因' : '修复说明'}：${patch.resolutionNotes}`);
    if (patch.gitCommitHash) parts.push(`commit: ${patch.gitCommitHash}`);
    try {
      const { addComment } = await import('./bug-comments.js');
      await addComment({
        bugId,
        authorType: patch.actor?.type ?? 'user',
        authorId: patch.actor?.id ?? null,
        content: parts.join('\n'),
      });
    } catch (err) {
      console.error('[vibehub] 活动流写入失败:', err);
    }
  }

  eventBus.publish({
    type: 'bug.updated',
    projectId: bug.projectId,
    bugId: bug.id,
    status: bug.status,
  });
  // 语义文本未变（改状态/严重度/优先级/指派等）则跳过——不打 DashScope，拖拽流转不再等外网（卡片 F2）
  const nextEmbeddingText = bugEmbeddingText(bug);
  if (nextEmbeddingText !== bugEmbeddingText(existing)) {
    await upsertEntityEmbedding('bug', bug.id, nextEmbeddingText);
  }
  return bug;
}

export async function getBug(bugId: string): Promise<Bug & { assignee: Person; reporter: Person }> {
  const bug = await prisma.bug.findUnique({
    where: { id: bugId },
    include: WITH_PEOPLE,
  });
  if (!bug) throw new NotFoundError(`缺陷不存在: ${bugId}`);
  return bug;
}

export async function getBugDetail(bugId: string): Promise<Bug & { attachments: Awaited<ReturnType<typeof listBugAttachments>> }> {
  const bug = await getBug(bugId);
  const attachments = await listBugAttachments(bugId);
  return { ...bug, attachments };
}

export async function listBugAttachments(bugId: string) {
  return prisma.attachment.findMany({
    where: { entityType: 'bug', entityId: bugId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function listBugs(query: BugListQuery = {}): Promise<BugListResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(Math.max(1, query.pageSize ?? 50), 200);

  const where: Prisma.BugWhereInput = {};
  if (query.projectId) where.projectId = query.projectId;
  if (query.status) where.status = query.status;
  if (query.severity) where.severity = query.severity;

  let items = await prisma.bug.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: 500,
    include: WITH_PEOPLE,
  });

  // 中文/拼音模糊检索在内存中进行（SQLite 无全文检索）
  if (query.q?.trim()) {
    const q = query.q.trim();
    items = items.filter((b) =>
      matchIndex(q, buildSearchIndex(b.title, `${b.actualResult ?? ''} ${b.stepsToReproduce ?? ''}`)),
    );
  }

  const total = items.length;
  const paged = items.slice((page - 1) * pageSize, page * pageSize);
  // 附件计数批量取（R78）：一次 groupBy 代替逐条 count
  const counts = await countAttachmentsFor('bug', paged.map((b) => b.id));
  const withCounts: BugWithMeta[] = paged.map((bug) => ({
    ...bug,
    attachmentCount: counts.get(bug.id) ?? 0,
  }));

  return { items: withCounts, total, page, pageSize };
}

export interface BugBoard {
  open: BugWithMeta[];
  in_progress: BugWithMeta[];
  resolved: BugWithMeta[];
  verifying: BugWithMeta[];
  verified: BugWithMeta[];
  closed: BugWithMeta[];
}

/** 看板视图：按状态分组的缺陷（Web 端三列主视图数据源） */
export async function getBugBoard(projectId: string, limitPerColumn = 100): Promise<BugBoard> {
  const all = await prisma.bug.findMany({
    where: { projectId },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: limitPerColumn * BUG_STATUSES.length,
    include: WITH_PEOPLE,
  });

  const groups: Record<string, Bug[]> = Object.fromEntries(BUG_STATUSES.map((st) => [st, [] as Bug[]]));
  for (const bug of all) {
    if (groups[bug.status]) groups[bug.status].push(bug);
  }

  // 先按列截断收集（暂无 attachmentCount），再批量取计数一次回填——避免逐条 count（原 500 条 = 500 次查询）
  const listed: Bug[] = [];
  const picked: Partial<Record<BugStatus, Bug[]>> = {};
  for (const status of Object.keys(groups) as BugStatus[]) {
    const column = groups[status].slice(0, limitPerColumn);
    picked[status] = column;
    listed.push(...column);
  }

  const counts = await countAttachmentsFor('bug', listed.map((b) => b.id));
  const board = Object.fromEntries(BUG_STATUSES.map((st) => [st, [] as BugWithMeta[]])) as unknown as BugBoard;
  for (const status of Object.keys(board) as BugStatus[]) {
    board[status] = (picked[status] ?? []).map((bug) => ({ ...bug, attachmentCount: counts.get(bug.id) ?? 0 }));
  }
  return board;
}

export async function moveBugToProject(bugId: string, targetProjectId: string): Promise<Bug> {
  const bug = await getBug(bugId);
  const target = await prisma.project.findUnique({ where: { id: targetProjectId } });
  if (!target) throw new NotFoundError(`目标项目不存在: ${targetProjectId}`);
  const moved = await prisma.bug.update({
    where: { id: bugId },
    data: { projectId: targetProjectId },
  });
  eventBus.publish({ type: 'bug.updated', projectId: moved.projectId, bugId: moved.id, status: moved.status });
  return moved;
}

export async function deleteBug(bugId: string): Promise<void> {
  const bug = await getBug(bugId);
  // bug_comments 没有外键级联（schema 里只存 bugId），不一起删会留下孤儿评论
  await prisma.$transaction([
    prisma.bugComment.deleteMany({ where: { bugId } }),
    prisma.bug.delete({ where: { id: bugId } }),
  ]);
  await deleteEntityEmbedding('bug', bugId);
  eventBus.publish({ type: 'bug.updated', projectId: bug.projectId, bugId, status: 'deleted' });
}
