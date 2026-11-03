import { prisma } from '../core/prisma.js';
import { isStale } from './stale.js';
import { getStats, type StatsResult } from './stats.js';
import type { DeliveryEvidence } from './evidence.js';

/**
 * 今日工作台聚合（R89）：跨项目、只读。
 * 只回答三个问题：现在要我处理什么、有什么等我验收、AI 正在干什么；
 * 统计数字直接复用 R85 的 getStats，不另建一套口径。
 */

export interface TodayActor {
  type: 'user' | 'ai';
  name: string;
}

export interface TodayPerson {
  id: string;
  name: string;
}

export interface TodayItem {
  kind: 'bug' | 'task';
  id: string;
  title: string;
  status: string;
  priority: string;
  severity: string | null;
  labels: string[];
  project: { id: string; name: string };
  assignee: TodayPerson | null;
  reporter?: TodayPerson | null;
  due_date: string | null;
  actor: TodayActor | null;
  since: string;
  stale: boolean;
  evidence: DeliveryEvidence | null;
}

export interface TodayResult {
  generated_at: string;
  date: string;
  projects: { id: string; name: string }[];
  needs_me: TodayItem[];
  to_verify: TodayItem[];
  ai_active: TodayItem[];
  active: TodayItem[];
  today: StatsResult['today'];
  remaining: StatsResult['remaining'];
  trend: StatsResult['trend'];
}

const BUG_ACTIVE = ['in_progress', 'resolved', 'verifying'];
const TASK_ACTIVE = ['doing', 'review', 'verifying'];
const BUG_MINE = ['open', 'in_progress'];
const TASK_MINE = ['todo', 'doing'];
const BUG_VERIFY = ['resolved', 'verifying'];
const TASK_VERIFY = ['review', 'verifying'];

function actorOf(row: { statusActorType: string | null; statusActorName: string | null }): TodayActor | null {
  return row.statusActorType
    ? { type: row.statusActorType as 'user' | 'ai', name: row.statusActorName ?? '未记录' }
    : null;
}

export async function getToday(userId: string, now: Date = new Date()): Promise<TodayResult> {
  const projects = await prisma.project.findMany({
    where: { archivedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true },
  });
  const projectIds = projects.map((p) => p.id);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const stats = await getStats({ projectId: null, projectIds }, now);

  if (projectIds.length === 0) {
    return {
      generated_at: now.toISOString(),
      date: stats.scope.today,
      projects: [],
      needs_me: [],
      to_verify: [],
      ai_active: [],
      active: [],
      today: stats.today,
      remaining: stats.remaining,
      trend: stats.trend,
    };
  }

  const [bugs, tasks] = await Promise.all([
    prisma.bug.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        title: true,
        status: true,
        priority: true,
        severity: true,
        labels: true,
        assigneeId: true,
        dueDate: true,
        reporterId: true,
        statusChangedAt: true,
        statusActorType: true,
        statusActorName: true,
        evidence: true,
        updatedAt: true,
      },
    }),
    prisma.task.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        title: true,
        status: true,
        priority: true,
        labels: true,
        assigneeId: true,
        statusChangedAt: true,
        statusActorType: true,
        statusActorName: true,
        evidence: true,
        updatedAt: true,
      },
    }),
  ]);

  const userIds = new Set<string>();
  for (const b of bugs) {
    if (b.assigneeId) userIds.add(b.assigneeId);
    if (b.reporterId) userIds.add(b.reporterId);
  }
  for (const t of tasks) if (t.assigneeId) userIds.add(t.assigneeId);
  const users = userIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } })
    : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const items: TodayItem[] = [];

  for (const b of bugs) {
    const activeStatus = BUG_ACTIVE.includes(b.status);
    const mine = b.assigneeId === userId && BUG_MINE.includes(b.status);
    const verify = BUG_VERIFY.includes(b.status);
    if (!activeStatus && !mine && !verify) continue;
    const since = b.statusChangedAt ?? b.updatedAt;
    items.push({
      kind: 'bug',
      id: b.id,
      title: b.title,
      status: b.status,
      priority: b.priority,
      severity: b.severity,
      labels: b.labels,
      project: { id: b.projectId, name: projectName.get(b.projectId) ?? '未知项目' },
      assignee: b.assigneeId ? { id: b.assigneeId, name: userName.get(b.assigneeId) ?? '已移除成员' } : null,
      reporter: b.reporterId ? { id: b.reporterId, name: userName.get(b.reporterId) ?? '已移除成员' } : null,
      due_date: b.dueDate?.toISOString() ?? null,
      actor: actorOf(b),
      since: since.toISOString(),
      stale: isStale(b.status, since, now),
      evidence: (b.evidence as DeliveryEvidence | null) ?? null,
    });
  }

  for (const t of tasks) {
    const activeStatus = TASK_ACTIVE.includes(t.status);
    const mine = t.assigneeId === userId && TASK_MINE.includes(t.status);
    const verify = TASK_VERIFY.includes(t.status);
    if (!activeStatus && !mine && !verify) continue;
    const since = t.statusChangedAt ?? t.updatedAt;
    items.push({
      kind: 'task',
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      severity: null,
      labels: t.labels,
      project: { id: t.projectId, name: projectName.get(t.projectId) ?? '未知项目' },
      assignee: t.assigneeId ? { id: t.assigneeId, name: userName.get(t.assigneeId) ?? '已移除成员' } : null,
      due_date: null,
      actor: actorOf(t),
      since: since.toISOString(),
      stale: isStale(t.status, since, now),
      evidence: (t.evidence as DeliveryEvidence | null) ?? null,
    });
  }

  const needsMe = items.filter((i) => i.assignee?.id === userId && (i.kind === 'bug' ? BUG_MINE : TASK_MINE).includes(i.status));
  const toVerify = items.filter((i) => (i.kind === 'bug' ? BUG_VERIFY : TASK_VERIFY).includes(i.status));
  const aiActive = items.filter((i) => i.actor?.type === 'ai' && (i.kind === 'bug' ? BUG_ACTIVE : TASK_ACTIVE).includes(i.status));
  const active = items
    .filter((i) => (i.kind === 'bug' ? BUG_ACTIVE : TASK_ACTIVE).includes(i.status))
    .sort((a, b) => Number(b.stale) - Number(a.stale) || new Date(a.since).getTime() - new Date(b.since).getTime());

  return {
    generated_at: now.toISOString(),
    date: stats.scope.today,
    projects,
    needs_me: needsMe,
    to_verify: toVerify,
    ai_active: aiActive,
    active,
    today: stats.today,
    remaining: stats.remaining,
    trend: stats.trend,
  };
}
