import { prisma } from '../core/prisma.js';
import { parseStatusChangeComment } from './stats-legacy.js';
import { beijingDayBounds, beijingTrendDays } from './stats-time.js';
import { isStale } from './stale.js';

/**
 * 统计页聚合（R85，docs/计划/07 §7.16）。
 * 「今天」按北京时间自然日；缺陷修复完成 = verified，或老流程 verified→closed；
 * 任务完成 = done。全部只读，不改任何写路径、不新增表。
 */

export interface ActorRef {
  type: 'user' | 'ai';
  name: string;
}

export interface BugOutcome {
  kind: 'fixed' | 'closed_unfixed';
  at: Date;
  actor: ActorRef | null;
}

export interface TaskOutcome {
  at: Date;
  actor: ActorRef | null;
}

/** 从最后一条「状态变更」评论解析出的兜底信息（无 statusChangedAt 的老数据才需要） */
export interface LegacyLookup {
  /** 转移前的状态码（如 'verified'） */
  from: string;
  at: Date;
  actor: ActorRef | null;
}

interface StatusFields {
  status: string;
  statusChangedAt: Date | null;
  statusActorType: string | null;
  statusActorName: string | null;
  updatedAt: Date;
}

function currentActor(row: StatusFields): ActorRef | null {
  return row.statusActorType ? { type: row.statusActorType as 'user' | 'ai', name: row.statusActorName ?? '' } : null;
}

/**
 * 缺陷是否「有结果」了，以及结果是什么。只对 verified / closed 判定；其余状态返回 null。
 * closed 且 statusChangedAt 非空时不必回看来源：R83 起 verified→closed 已被状态机禁止，
 * 能有 statusChangedAt 就说明是新规则下产生的关闭，必然不是从 verified 来的。
 */
export function resolveBugOutcome(bug: StatusFields, legacy: LegacyLookup | null): BugOutcome | null {
  if (bug.status === 'verified') {
    if (bug.statusChangedAt) return { kind: 'fixed', at: bug.statusChangedAt, actor: currentActor(bug) };
    return { kind: 'fixed', at: legacy?.at ?? bug.updatedAt, actor: legacy?.actor ?? null };
  }
  if (bug.status === 'closed') {
    if (bug.statusChangedAt) return { kind: 'closed_unfixed', at: bug.statusChangedAt, actor: currentActor(bug) };
    if (legacy) return { kind: legacy.from === 'verified' ? 'fixed' : 'closed_unfixed', at: legacy.at, actor: legacy.actor };
    return { kind: 'closed_unfixed', at: bug.updatedAt, actor: null };
  }
  return null;
}

/** 任务是否已完成（status === done）；没有活动流可查，老数据回退 updatedAt、经手人记未知（null） */
export function resolveTaskOutcome(task: StatusFields): TaskOutcome | null {
  if (task.status !== 'done') return null;
  if (task.statusChangedAt) return { at: task.statusChangedAt, actor: currentActor(task) };
  return { at: task.updatedAt, actor: null };
}

export interface StatsScope {
  /** null = 全部项目 */
  projectId: string | null;
}

interface ActiveItem {
  kind: 'bug' | 'task';
  id: string;
  title: string;
  status: string;
  project_id: string;
  actor: ActorRef | null;
  since: string;
  stale: boolean;
}

interface ByActorRow {
  type: 'user' | 'ai';
  name: string;
  in_hand_bugs: number;
  in_hand_tasks: number;
  fixed_today: number;
  done_today: number;
}

export interface StatsResult {
  scope: { project_id: string | null; today: string; timezone: string; days: number };
  today: { bugs_fixed: number; bugs_closed_unfixed: number; tasks_done: number; bugs_created: number; tasks_created: number };
  remaining: {
    bugs: { unresolved: number; unverified: number };
    tasks: { todo: number; doing: number; unverified: number };
  };
  active: ActiveItem[];
  by_actor: ByActorRow[];
  trend: { date: string; bugs_fixed: number; tasks_done: number }[];
}

const TREND_DAYS = 14;
/** 「手上」不含 resolved/review（等别人接手，不算在这个人手上）；active 列表包含它们 */
const BUG_ACTIVE_STATUSES = ['in_progress', 'resolved', 'verifying'];
const BUG_IN_HAND_STATUSES = ['in_progress', 'verifying'];
const TASK_ACTIVE_STATUSES = ['doing', 'review', 'verifying'];
const TASK_IN_HAND_STATUSES = ['doing', 'verifying'];

function inRange(at: Date, start: Date, end: Date): boolean {
  return at.getTime() >= start.getTime() && at.getTime() < end.getTime();
}

function actorKey(actor: ActorRef): string {
  return `${actor.type}::${actor.name}`;
}

function getOrCreateActorRow(map: Map<string, ByActorRow>, actor: ActorRef): ByActorRow {
  const key = actorKey(actor);
  let row = map.get(key);
  if (!row) {
    row = { type: actor.type, name: actor.name, in_hand_bugs: 0, in_hand_tasks: 0, fixed_today: 0, done_today: 0 };
    map.set(key, row);
  }
  return row;
}

export async function getStats(scope: StatsScope, now: Date = new Date()): Promise<StatsResult> {
  const where = scope.projectId ? { projectId: scope.projectId } : {};
  const [bugs, tasks] = await Promise.all([
    prisma.bug.findMany({
      where,
      select: { id: true, projectId: true, title: true, status: true, statusChangedAt: true, statusActorType: true, statusActorName: true, createdAt: true, updatedAt: true },
    }),
    prisma.task.findMany({
      where,
      select: { id: true, projectId: true, title: true, status: true, statusChangedAt: true, statusActorType: true, statusActorName: true, createdAt: true, updatedAt: true },
    }),
  ]);

  // 老数据兜底：只为「无 statusChangedAt 且已到终态」的缺陷查评论，避免全表扫描
  const legacyBugIds = bugs.filter((b) => !b.statusChangedAt && (b.status === 'verified' || b.status === 'closed')).map((b) => b.id);
  const legacyLookupByBugId = await buildLegacyLookup(legacyBugIds);

  const bugOutcomes = new Map(bugs.map((b) => [b.id, resolveBugOutcome(b, legacyLookupByBugId.get(b.id) ?? null)]));
  const taskOutcomes = new Map(tasks.map((t) => [t.id, resolveTaskOutcome(t)]));

  const todayBounds = beijingDayBounds(now);

  // ── 今天 ──
  let bugsFixed = 0, bugsClosedUnfixed = 0, tasksDone = 0;
  for (const outcome of bugOutcomes.values()) {
    if (!outcome || !inRange(outcome.at, todayBounds.start, todayBounds.end)) continue;
    if (outcome.kind === 'fixed') bugsFixed++; else bugsClosedUnfixed++;
  }
  for (const outcome of taskOutcomes.values()) {
    if (outcome && inRange(outcome.at, todayBounds.start, todayBounds.end)) tasksDone++;
  }
  const bugsCreated = bugs.filter((b) => inRange(b.createdAt, todayBounds.start, todayBounds.end)).length;
  const tasksCreated = tasks.filter((t) => inRange(t.createdAt, todayBounds.start, todayBounds.end)).length;

  // ── 还剩多少 ──
  const remaining = {
    bugs: {
      unresolved: bugs.filter((b) => b.status === 'open' || b.status === 'in_progress').length,
      unverified: bugs.filter((b) => b.status === 'resolved' || b.status === 'verifying').length,
    },
    tasks: {
      todo: tasks.filter((t) => t.status === 'todo').length,
      doing: tasks.filter((t) => t.status === 'doing').length,
      unverified: tasks.filter((t) => t.status === 'review' || t.status === 'verifying').length,
    },
  };

  // ── 现在谁在做什么 ──
  const active: ActiveItem[] = [];
  for (const b of bugs) {
    if (!BUG_ACTIVE_STATUSES.includes(b.status)) continue;
    const since = b.statusChangedAt ?? legacyLookupByBugId.get(b.id)?.at ?? b.updatedAt;
    const actor = b.statusActorType ? { type: b.statusActorType as 'user' | 'ai', name: b.statusActorName ?? '' } : legacyLookupByBugId.get(b.id)?.actor ?? null;
    active.push({ kind: 'bug', id: b.id, title: b.title, status: b.status, project_id: b.projectId, actor, since: since.toISOString(), stale: isStale(b.status, since, now) });
  }
  for (const t of tasks) {
    if (!TASK_ACTIVE_STATUSES.includes(t.status)) continue;
    const since = t.statusChangedAt ?? t.updatedAt;
    const actor = t.statusActorType ? { type: t.statusActorType as 'user' | 'ai', name: t.statusActorName ?? '' } : null;
    active.push({ kind: 'task', id: t.id, title: t.title, status: t.status, project_id: t.projectId, actor, since: since.toISOString(), stale: isStale(t.status, since, now) });
  }
  active.sort((a, b) => (Number(b.stale) - Number(a.stale)) || (new Date(a.since).getTime() - new Date(b.since).getTime()));

  // ── 按密钥 ──
  const byActor = new Map<string, ByActorRow>();
  for (const b of bugs) {
    if (!BUG_IN_HAND_STATUSES.includes(b.status) || !b.statusActorType) continue;
    getOrCreateActorRow(byActor, { type: b.statusActorType as 'user' | 'ai', name: b.statusActorName ?? '' }).in_hand_bugs++;
  }
  for (const t of tasks) {
    if (!TASK_IN_HAND_STATUSES.includes(t.status) || !t.statusActorType) continue;
    getOrCreateActorRow(byActor, { type: t.statusActorType as 'user' | 'ai', name: t.statusActorName ?? '' }).in_hand_tasks++;
  }
  for (const outcome of bugOutcomes.values()) {
    if (!outcome || outcome.kind !== 'fixed' || !outcome.actor || !inRange(outcome.at, todayBounds.start, todayBounds.end)) continue;
    getOrCreateActorRow(byActor, outcome.actor).fixed_today++;
  }
  for (const outcome of taskOutcomes.values()) {
    if (!outcome || !outcome.actor || !inRange(outcome.at, todayBounds.start, todayBounds.end)) continue;
    getOrCreateActorRow(byActor, outcome.actor).done_today++;
  }

  // ── 最近 14 天趋势 ──
  const trendDays = beijingTrendDays(now, TREND_DAYS);
  const trend = trendDays.map((d) => {
    let bugsFixedDay = 0, tasksDoneDay = 0;
    for (const outcome of bugOutcomes.values()) if (outcome?.kind === 'fixed' && inRange(outcome.at, d.start, d.end)) bugsFixedDay++;
    for (const outcome of taskOutcomes.values()) if (outcome && inRange(outcome.at, d.start, d.end)) tasksDoneDay++;
    return { date: d.dateStr, bugs_fixed: bugsFixedDay, tasks_done: tasksDoneDay };
  });

  return {
    scope: { project_id: scope.projectId, today: todayBounds.dateStr, timezone: 'Asia/Shanghai', days: TREND_DAYS },
    today: { bugs_fixed: bugsFixed, bugs_closed_unfixed: bugsClosedUnfixed, tasks_done: tasksDone, bugs_created: bugsCreated, tasks_created: tasksCreated },
    remaining,
    active,
    by_actor: [...byActor.values()],
    trend,
  };
}

/** 批量查「最后一条状态变更评论」+ 批量解析作者名，避免逐条 N+1 查询 */
async function buildLegacyLookup(bugIds: string[]): Promise<Map<string, LegacyLookup>> {
  const out = new Map<string, LegacyLookup>();
  if (bugIds.length === 0) return out;

  const comments = await prisma.bugComment.findMany({
    where: { bugId: { in: bugIds }, content: { startsWith: '状态变更：' } },
    orderBy: [{ bugId: 'asc' }, { createdAt: 'desc' }],
  });
  // 按 bugId 升序 + createdAt 降序排列后，每个 bugId 分组里第一条就是最新一条
  const lastCommentByBugId = new Map<string, (typeof comments)[number]>();
  for (const c of comments) if (!lastCommentByBugId.has(c.bugId)) lastCommentByBugId.set(c.bugId, c);

  const aiAuthorIds = [...new Set([...lastCommentByBugId.values()].filter((c) => c.authorType === 'ai' && c.authorId).map((c) => c.authorId!))];
  const userAuthorIds = [...new Set([...lastCommentByBugId.values()].filter((c) => c.authorType === 'user' && c.authorId).map((c) => c.authorId!))];
  const [keys, users] = await Promise.all([
    aiAuthorIds.length ? prisma.apiKey.findMany({ where: { id: { in: aiAuthorIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    userAuthorIds.length ? prisma.user.findMany({ where: { id: { in: userAuthorIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const nameByKeyId = new Map(keys.map((k) => [k.id, k.name]));
  const nameByUserId = new Map(users.map((u) => [u.id, u.name]));

  for (const [bugId, comment] of lastCommentByBugId) {
    const parsed = parseStatusChangeComment(comment.content);
    if (!parsed) continue;
    const name = comment.authorType === 'ai'
      ? (comment.authorId ? nameByKeyId.get(comment.authorId) ?? null : null)
      : (comment.authorId ? nameByUserId.get(comment.authorId) ?? null : null);
    out.set(bugId, {
      from: parsed.from,
      at: comment.createdAt,
      actor: name ? { type: comment.authorType as 'user' | 'ai', name } : null,
    });
  }
  return out;
}
