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
