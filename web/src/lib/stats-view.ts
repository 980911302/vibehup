import type { StatsByActor } from './stats-types';

/** 手上未结 + 今天完成 的总量，用来给「按密钥」表排序（API 不保证顺序） */
function activityScore(row: StatsByActor): number {
  return row.in_hand_bugs + row.in_hand_tasks + row.fixed_today + row.done_today;
}

/** 活跃度降序；打平按名字排序，结果稳定 */
export function sortByActorActivity(rows: StatsByActor[]): StatsByActor[] {
  return [...rows].sort((a, b) => activityScore(b) - activityScore(a) || a.name.localeCompare(b.name));
}

/** api.stats 的 project_id 查询参数：null（全部项目）映射为 'all' */
export function scopeParam(projectId: string | null): string {
  return projectId ?? 'all';
}